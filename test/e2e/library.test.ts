import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';
import { RecipeLibraryRepository, RecipeLibraryService } from '../../src/modules/recipes/index.js';

/** Recetario: recipes_raw en inglés con macros por tabla, y recomendaciones que aprenden del 👎. */
describe('biblioteca de recetas', () => {
  let app: FastifyInstance;
  const users: Record<string, ReturnType<typeof client>> = {};
  const restrictions = (dietStyle: string, allergyIds: string[] = []) => ({ dietStyle, allergyIds, careIds: [], customExclusions: [] });
  const raw = (_id: number, title: string, ingredients: string[], ner: string[] = [], directions = ['Mix all.', 'Cook 20 minutes.']) => ({ _id, title, ingredients, ner, nIngredients: ingredients.length, directions });
  const serviceOn = (c: FastifyInstance['container']) => new RecipeLibraryService(c.pg.db, new RecipeLibraryRepository(c.mongo.rawRecipes), c.repos.recipes, c.services.catalog, c.log);

  beforeAll(async () => {
    await resetDatabases();
    app = await testApp();
    await app.container.mongo.rawRecipes.insertMany([
      raw(1, 'Chickpea Stew', ['2 c. chickpeas', '2 tomatoes', '1 onion', 'salt to taste'], ['chickpea', 'tomato'], ['Chop the onion.', 'Cook chickpeas and tomatoes 25 minutes.']),
      raw(2, 'Mac and Cheese', ['1 lb. macaroni', '2 c. cheddar cheese', '1 c. milk'], ['macaroni', 'cheddar cheese']),
      raw(3, 'Mystery Bake', ['1 can cream of mushroom soup', '1 c. rice', '1 onion']),
      raw(4, 'chickpea  stew!', ['2 c. chickpeas', '2 tomatoes', '1 onion'], ['chickpea']),
      raw(5, 'Chickpea Salad', ['2 c. chickpeas', '1 cucumber', '1 Tbsp. olive oil'], ['chickpea', 'cucumber']),
      raw(6, 'Chickpeas and Feta', ['2 c. chickpeas', '1 c. feta cheese', '1 Tbsp. oil'], ['chickpea']),
      ...Array.from({ length: 150 }, (_, i) => (i % 3 === 0 ? raw(100 + i, `Cheese Rice ${i}`, ['1 c. rice', '1 c. cheddar cheese', '1 onion']) : raw(100 + i, `Rice and Beans ${i}`, ['1 c. rice', '1 c. black beans', '1 onion']))),
    ]);
    for (const [name, r] of Object.entries({ omni: restrictions('omnivore'), vegan: restrictions('vegan') })) {
      const api = (users[name] = client(app));
      const reg = await api.post('/auth/register', { name, email: `${name}@correo.co`, password: 'supersecreta', acceptedTermsVersion: '2026-09' });
      api.setToken(reg.body.data.tokens.accessToken);
      await api.post('/me/onboarding/complete', { ...ONBOARDING_PAYLOAD, restrictions: r });
    }
    await drain(app);
  });
  afterAll(async () => app?.close());
  const ideas = async (who: string, q = '') => (await users[who]!.get(`/me/recommendations?limit=20${q}`)).body.data as any[];

  it('explorar las trae en la primera visita, en inglés, con calorías y solo lo que cada quien puede comer', async () => {
    const r = (await users.omni!.get('/me/recommendations?limit=20')).body;
    expect(r.data[0]).toMatchObject({ reason: { label: 'Recetario' }, nutritionEstimated: true });
    expect(r.meta.library).toMatchObject({ status: 'ready' });
    expect(r.meta.library.count).toBeGreaterThanOrEqual(60);
    expect(r.data.every((x: any) => x.nutritionPerServing.kcal > 0)).toBe(true);
    expect([...new Set(r.data.map((x: any) => x.reason.label))]).toEqual(expect.arrayContaining(['De la comunidad', 'Recetario']));
    const vegan = (await users.vegan!.get('/me/recommendations?limit=20&source=library')).body;
    expect(vegan.data.length).toBe(20);
    expect(vegan.data.every((x: any) => x.nutritionEstimated && !/cheese|feta/i.test(x.title))).toBe(true);
    expect(vegan.meta.library.count).toBeGreaterThanOrEqual(60);
    expect(await app.container.repos.recipes.byId('rcp_raw_3')).toBeNull(); // una línea que no se entiende
  });

  it('filtros y páginas; fuera de explorar no salen', async () => {
    const all = await ideas('omni', '');
    expect(all.length).toBe(20);
    expect((await ideas('omni', '&maxMinutes=15')).every((r) => r.totalTimeMinutes.max <= 25)).toBe(true);
    const p1 = (await users.omni!.get('/me/recommendations?limit=20&source=library')).body;
    const p2 = (await users.omni!.get(`/me/recommendations?limit=20&source=library&cursor=${p1.meta.nextCursor}`)).body;
    expect(new Set([...p1.data, ...p2.data].map((r: any) => r.id)).size).toBe(40);
    for (const q of ['&slot=lunch', '&source=pantry', '&usingIngredientIds=ing_rice']) {
      const r = (await users.omni!.get(`/me/recommendations?limit=20${q}`)).body;
      expect(r.data.some((x: any) => x.id.startsWith('rcp_raw_')), q).toBe(false);
      expect(r.meta.library).toBeUndefined();
    }
    expect((await users.omni!.get('/me/home')).body.data.ideas.items.some((x: any) => x.id.startsWith('rcp_raw_'))).toBe(false);
  });

  it('bajo pedido del chef: máximo dos distintas y sin lo que choca', async () => {
    const svc = serviceOn(app.container);
    const noDairy = { ingredients: ['Chickpea', '$where', 'unobtainium'], avoid: (f: { allergens: string[] }) => f.allergens.includes('lactose'), excludeRecipeIds: [] as string[] };
    const first = await svc.forRequest(noDairy);
    expect(first).toEqual(['rcp_raw_1', 'rcp_raw_5']);
    expect(await svc.forRequest(noDairy)).toEqual(first);
    expect(await svc.forRequest({ ...noDairy, excludeRecipeIds: first })).toEqual(['rcp_raw_4']);
    expect(await svc.forRequest({ ...noDairy, ingredients: ['dragonfruit'] })).toEqual([]);
    const me = (await app.container.repos.users.findByEmail('omni@correo.co'))!;
    expect(await app.container.services.recipes.compatible(me.id, first)).toHaveLength(2);
  });

  it('topes: lleno no busca; si no encuentra suficientes descansa y reintenta después; Mongo caído no rompe', async () => {
    const svc = serviceOn(app.container);
    expect(await svc.fillForExplore(60, () => false)).toBe('ready');
    const t = Date.now();
    expect(await svc.fillForExplore(0, () => true, t)).toBe('paused');
    expect(await svc.fillForExplore(0, () => true, t + 1000)).toBe('paused');
    const dead = new RecipeLibraryService(app.container.pg.db, { sample: async () => Promise.reject(new Error('mongo')), search: async () => [] } as never, app.container.repos.recipes, app.container.services.catalog, app.container.log);
    expect(await dead.fillForExplore(0, () => false)).toBe('paused');
  });

  it('se pueden abrir, cocinar y mandar a la lista, con ingredientes por paso', async () => {
    const api = users.omni!;
    const d = (await api.get('/recipes/rcp_raw_1')).body.data;
    expect(d).toMatchObject({ title: 'Chickpea Stew', nutritionEstimated: true, stepsCount: 2, author: { type: 'noshy' } });
    expect(d.steps.map((st: any) => st.ingredients.map((i: any) => i.label))).toEqual([['Onion', 'Salt'], ['Chickpeas', 'Tomatoes']]);
    expect(d.ingredients[0]).toMatchObject({ label: 'Chickpeas', ingredientId: 'raw_beans_chickpeas', quantity: { value: 2, unit: 'cup' } });
    expect((await api.post('/me/shopping-lists/current/recipes', { recipeId: 'rcp_raw_1' })).status).toBeLessThan(300);
    expect((await api.get('/me/shopping-lists/current')).status).toBe(200);
    const cook = await api.post('/me/cooking-sessions', { recipeId: 'rcp_raw_1', servings: d.servings.value });
    expect(cook.status, JSON.stringify(cook.body)).toBe(201);
    await api.post(`/me/cooking-sessions/${cook.body.data.id}/abandon`, { atStepIndex: 0, reason: 'later' });
    // No ensucian el buscador.
    expect((await api.get('/catalog/ingredients/search?q=chickpeas')).body.data).toEqual([]);
  });

  it('la foto del plato se ve en Cocinadas y en Inicio, la más reciente y solo para su dueño', async () => {
    const api = users.omni!;
    const photo = async () => {
      const up = (await api.post('/media/uploads', { purpose: 'cookedPhoto', contentType: 'image/jpeg', sizeBytes: 100 })).body.data;
      const url = new URL(up.uploadUrl);
      const send = () => app.inject({ method: 'PUT', url: `${url.pathname}${url.search}`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.alloc(100, 1) });
      return { id: up.mediaId as string, send };
    };
    const cook = async (photoMediaId: string | null, at: string) => {
      const c = await api.post('/me/cooking-sessions', { recipeId: 'rcp_raw_1', servings: 2 });
      return api.post(`/me/cooking-sessions/${c.body.data.id}/complete`, { finishedAt: at, logMeal: null, ...(photoMediaId ? { photoMediaId } : {}) });
    };
    const find = async (who: string) => (await users[who]!.get('/me/cooked-recipes')).body.data.find((r: any) => r.recipe.id === 'rcp_raw_1');
    const [a, b] = [await photo(), await photo()];
    await a.send();
    await b.send();
    expect((await cook(a.id, '2026-11-01T12:00:00Z')).status).toBe(200);
    expect((await cook(b.id, '2026-11-02T12:00:00Z')).status).toBe(200);
    expect((await cook(null, '2026-11-03T12:00:00Z')).status).toBe(200);
    const row = await find('omni');
    expect(row).toMatchObject({ timesCooked: 3, photoUrl: expect.stringContaining(b.id) });
    expect(row.recipe.imageUrl).toBe(row.photoUrl);
    expect((await app.inject({ method: 'GET', url: new URL(row.photoUrl).pathname })).statusCode).toBe(200);
    expect((await api.get('/me/home')).body.data.mostCooked[0].imageUrl).toBe(row.photoUrl);
    expect((await api.get('/recipes/rcp_raw_1')).body.data.imageUrl).toBeNull();
    expect(await find('vegan')).toBeUndefined();
  });

  it('la API ve lo que importó otro proceso', async () => {
    const other = await testApp();
    try {
      await app.container.mongo.rawRecipes.insertOne(raw(900, 'Lentil Soup', ['1 c. lentils', '1 leek', '3 c. water'], ['beluga lentil']));
      expect(await serviceOn(other.container).forRequest({ ingredients: ['beluga lentil'], avoid: () => false, excludeRecipeIds: [] })).toEqual(['rcp_raw_900']);
      const seen: string[] = [];
      for (let cursor = ''; ; ) {
        const page = (await users.vegan!.get(`/me/recommendations?limit=20&source=library${cursor}`)).body;
        seen.push(...page.data.map((r: any) => r.id));
        if (!page.meta.nextCursor) break;
        cursor = `&cursor=${page.meta.nextCursor}`;
      }
      expect(seen).toContain('rcp_raw_900');
    } finally {
      await other.close();
    }
  });

  it('👎 a una idea la quita de las recomendaciones; un 👍 posterior la devuelve', async () => {
    const api = users.omni!;
    const m = (await api.post('/me/chef/threads/main/messages', { clientMessageId: 'libtest01', input: { type: 'text', text: 'dame una idea', via: 'keyboard' } })).body.data.chefMessage;
    const card = m.blocks.find((b: any) => b.type === 'recipeCard');
    expect((await ideas('omni', '&source=pantry')).map((r) => r.id)).toContain(card.recipe.id);
    await api.post(`/me/chef/messages/${m.id}/feedback`, { blockId: card.id, rating: 'down' });
    await drain(app);
    expect((await ideas('omni', '&source=pantry')).map((r) => r.id)).not.toContain(card.recipe.id);
    expect((await ideas('vegan')).length).toBeGreaterThan(0);
    await api.post(`/me/chef/messages/${m.id}/feedback`, { blockId: card.id, rating: 'up' });
    await drain(app);
    expect((await ideas('omni', '&source=pantry')).map((r) => r.id)).toContain(card.recipe.id);
  });
});
