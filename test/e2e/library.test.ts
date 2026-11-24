import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';
import { LlmChefEngine, RuleBasedChefEngine } from '../../src/modules/chef/chef.providers.js';
import { OpenRouterClient } from '../../src/infrastructure/ai/openrouter.client.js';
import { RecipeLibraryRepository, RecipeLibraryService } from '../../src/modules/recipes/index.js';

/** Recetario: recipes_raw en inglés con macros por tabla, y recomendaciones que aprenden del 👎. */
describe('biblioteca de recetas', () => {
  let app: FastifyInstance;
  const users: Record<string, ReturnType<typeof client>> = {};
  const restrictions = (dietStyle: string, allergyIds: string[] = []) => ({ dietStyle, allergyIds, careIds: [], customExclusions: [] });
  const raw = (_id: number, title: string, ingredients: string[], ner: string[] = [], directions = ['Mix all.', 'Cook 20 minutes.']) => ({ _id, title, ingredients, ner, nIngredients: ingredients.length, directions });
  const serviceOn = (c: FastifyInstance['container']) => new RecipeLibraryService(c.pg.db, new RecipeLibraryRepository(c.mongo.rawRecipes), c.repos.recipes, c.services.catalog, c.services.recipePhotos, c.log);

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

  it('traen foto de referencia que sí se puede descargar; las que ya estaban la reciben al arrancar', async () => {
    const { container: c } = app;
    const d = (await users.omni!.get('/recipes/rcp_raw_1')).body.data;
    expect(d).toMatchObject({ imageIsReference: true, imageUrl: expect.stringMatching(/\/api\/v1\/dishes\/[a-z-]+-\d\.webp$/) });
    const img = await app.inject({ method: 'GET', url: new URL(d.imageUrl).pathname });
    expect([img.statusCode, img.headers['content-type'], img.headers['cross-origin-resource-policy']]).toEqual([200, 'image/webp', 'cross-origin']);
    for (const bad of ['nope-1.webp', 'cookies-9.webp', '..%2f..%2fpackage.json', 'CREDITS.md', 'constructor-1.webp']) expect((await app.inject({ method: 'GET', url: `/api/v1/dishes/${bad}` })).statusCode, bad).toBe(404);
    await c.pg.pool.query("update recipes set image_url = null where id = 'rcp_raw_5'");
    await c.services.recipePhotos.backfill();
    expect((await c.repos.recipes.byId('rcp_raw_5'))!.imageUrl).toContain('/dishes/salad-');
    expect((await c.pg.pool.query("select count(*)::int n from recipes where image_url like 'https://cdn.noshy.app/%'")).rows[0].n).toBe(0);
    expect(await c.services.recipePhotos.backfill()).toBe(0);
  });

  it('la receta que inventa el chef se guarda, se abre, se cocina y solo la ve su dueño', async () => {
    const { container: c } = app;
    const me = (await c.repos.users.findByEmail('omni@correo.co'))!;
    const vegan = (await c.repos.users.findByEmail('vegan@correo.co'))!;
    const make = async (userId: string, ...drafts: unknown[]) => c.services.generatedRecipes.create(userId, await c.services.preferences.getOrThrow(userId), [], drafts);
    const draft = {
      title: 'Pollo al curry con garbanzos', dish: 'chicken curry', servings: '2', minutes: 25.4, difficulty: 'fácil', mealSlots: ['dinner', 'cena'],
      ingredients: [
        { name: 'Pechuga de pollo', value: 300, unit: 'gramos', grams: 300 },
        { name: 'garbanzos cocidos', value: 1, unit: 'taza', grams: 160 },
        { name: 'curry en polvo', value: 1, unit: 'cda', grams: 6 },
        { name: 'sal', value: 0, unit: 'al gusto' },
      ],
      steps: [{ text: 'Dora el pollo con el curry.', minutes: 10, ingredients: ['pechuga de pollo', 'curry en polvo', 'sal'] }, { text: 'Agrega los garbanzos y cocina.', minutes: 10, ingredients: ['garbanzos cocidos'] }],
      perServing: { kcal: 430, proteinG: 48, carbsG: 22, fatG: 14 },
    };
    const [id] = await make(me.id, draft, { title: 'Sin nada' }, draft);
    expect(id).toMatch(/^rcp_ai_/);
    const api = users.omni!;
    const d = (await api.get(`/recipes/${id}`)).body.data;
    expect(d).toMatchObject({ title: draft.title, author: { type: 'chef' }, servings: { value: 2 }, totalTimeMinutes: { max: 25 }, stepsCount: 2, difficulty: { id: 'easy' }, compatibility: { ok: true } });
    expect(d.imageUrl).toContain('/dishes/');
    expect(d.nutritionPerServing.kcal).toBeGreaterThan(200);
    expect(d.steps.map((s: any) => [s.timerSeconds, s.ingredients.length])).toEqual([[600, 3], [600, 1]]);
    expect(d.ingredients[1]).toMatchObject({ quantity: { value: 1, unit: 'cup' } });
    // Privada: ni otra persona, ni Explorar, ni edición o publicación.
    expect((await users.vegan!.get(`/recipes/${id}`)).status).toBe(404);
    expect((await api.patch(`/me/recipes/${id}`, { title: 'x' })).status).toBe(404);
    expect((await api.post(`/me/recipes/${id}/publish`)).status).toBe(404);
    expect((await ideas('omni')).some((r) => r.id === id)).toBe(false);
    expect((await api.put(`/me/saved-recipes/${id}`)).status).toBeLessThan(300);
    expect((await api.post('/me/shopping-lists/current/recipes', { recipeId: id })).status).toBeLessThan(300);
    const cook = await api.post('/me/cooking-sessions', { recipeId: id, servings: 2 });
    expect(cook.status, JSON.stringify(cook.body)).toBe(201);
    await api.post(`/me/cooking-sessions/${cook.body.data.id}/abandon`, { atStepIndex: 0, reason: 'later' });
    // No se confía en el modelo: se revisan ingredientes, pasos y calorías.
    expect(await make(vegan.id, draft)).toEqual([]);
    const veg = { ...draft, title: 'Garbanzos guisados', dish: 'stew', ingredients: draft.ingredients.slice(1), steps: [{ text: 'Cocina los garbanzos.' }] };
    expect(await make(vegan.id, veg)).toHaveLength(1);
    expect(await make(vegan.id, { ...veg, steps: [{ text: 'Cocina los garbanzos con mantequilla.' }] })).toEqual([]);
    expect(await make(vegan.id, { ...veg, title: 'Garbanzos con tocineta' })).toEqual([]);
    expect(await make(me.id, { ...veg, perServing: { kcal: 9000, proteinG: 900, carbsG: 900, fatG: 900 } })).toEqual([]);
    expect(await make(me.id, { ...veg, perServing: null })).toEqual([]);
  });

  it('en el chat: el JSON del modelo llega como tarjeta que se puede abrir, y «otra idea» inventa otra', async () => {
    const api = users.vegan!;
    const recipe = (title: string, extra: string) => ({
      title, dish: 'stew', servings: 2, minutes: 20, difficulty: 'easy', mealSlots: ['lunch'],
      ingredients: [{ name: 'Garbanzos', value: 200, unit: 'g', grams: 200 }, { name: extra, value: 100, unit: 'g', grams: 100 }],
      steps: [{ text: 'Cocina todo.', minutes: 15, ingredients: ['Garbanzos', extra] }], perServing: { kcal: 300, proteinG: 15, carbsG: 40, fatG: 8 },
    });
    const replies = [recipe('Garbanzos con espinaca', 'Espinaca'), recipe('Garbanzos con ahuyama', 'Ahuyama'), recipe('Garbanzos con tocineta', 'Tocineta')];
    const asked: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      asked.push(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: 'Te armé esta.', recipeIds: [], recipes: [replies.shift()] }) } }] }));
    }) as unknown as typeof fetch;
    const chef = app.container.services.chef as unknown as { engine: unknown };
    const before = chef.engine;
    chef.engine = new LlmChefEngine(new OpenRouterClient('k', ['m'], app.container.log, 1000, fake), new RuleBasedChefEngine(), app.container.log);
    try {
      const send = async (n: number, input: unknown) => (await api.post('/me/chef/threads/main/messages', { clientMessageId: `aitest0${n}`, input })).body.data.chefMessage;
      const cardOf = (m: any) => m.blocks.find((b: any) => b.type === 'recipeCard');
      const m1 = await send(1, { type: 'text', text: 'algo con garbanzos', via: 'keyboard' });
      expect(cardOf(m1).recipe).toMatchObject({ id: expect.stringMatching(/^rcp_ai_/), title: 'Garbanzos con espinaca', reason: { label: 'Creada para ti' }, imageIsReference: true, isSaved: false });
      expect((await api.get(`/recipes/${cardOf(m1).recipe.id}`)).body.data.steps[0].ingredients).toHaveLength(2);
      const m2 = await send(2, { type: 'action', action: { type: 'anotherIdea', messageId: m1.id, blockId: cardOf(m1).id } });
      expect(cardOf(m2).recipe.title).toBe('Garbanzos con ahuyama');
      expect(asked[1]).toContain('[Receta: Garbanzos con espinaca]');
      // Trae carne y es vegana: no se muestra; sale una que sí existe y puede comer.
      const m3 = await send(3, { type: 'text', text: 'otra receta', via: 'keyboard' });
      expect(cardOf(m3).recipe.id).not.toMatch(/^rcp_ai_/);
      expect(JSON.stringify(m3)).not.toContain('tocineta');
    } finally {
      chef.engine = before;
    }
  });

  it('topes: lleno no busca; si no encuentra suficientes descansa y reintenta después; Mongo caído no rompe', async () => {
    const svc = serviceOn(app.container);
    expect(await svc.fillForExplore(60, () => false)).toBe('ready');
    const t = Date.now();
    expect(await svc.fillForExplore(0, () => true, t)).toBe('paused');
    expect(await svc.fillForExplore(0, () => true, t + 1000)).toBe('paused');
    const dead = new RecipeLibraryService(app.container.pg.db, { sample: async () => Promise.reject(new Error('mongo')) } as never, app.container.repos.recipes, app.container.services.catalog, app.container.services.recipePhotos, app.container.log);
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
    expect((await api.get('/recipes/rcp_raw_1')).body.data.imageUrl).not.toBe(row.photoUrl);
    expect(await find('vegan')).toBeUndefined();
  });

  it('la API ve lo que importó otro proceso', async () => {
    const other = await testApp();
    try {
      // Otro proceso la trae; este aún no conoce sus ingredientes.
      for (let i = 0; i < 20 && !(await other.container.repos.recipes.byId('rcp_raw_900')); i++) {
        const svc = new RecipeLibraryService(other.container.pg.db, { sample: async () => [raw(900, 'Lentil Soup', ['1 c. lentils', '1 leek', '3 c. water'])] } as never, other.container.repos.recipes, other.container.services.catalog, other.container.services.recipePhotos, other.container.log);
        await svc.fillForExplore(0, () => false);
      }
      expect(await other.container.repos.recipes.byId('rcp_raw_900')).not.toBeNull();
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
