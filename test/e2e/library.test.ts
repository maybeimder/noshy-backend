import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';
import { RecipeLibraryRepository, RecipeLibraryService, type EstimatedRecipe, type RecipeEstimator } from '../../src/modules/recipes/index.js';

/** Recetas de recipes_raw con macros estimados, y recomendaciones que aprenden del 👎. */
describe('biblioteca de recetas', () => {
  let app: FastifyInstance;
  const users: Record<string, ReturnType<typeof client>> = {};
  const restrictions = (dietStyle: string, allergyIds: string[] = []) => ({ dietStyle, allergyIds, careIds: [], customExclusions: [] });
  const estimate = (sourceId: number, title: string, labels: string[]): EstimatedRecipe => ({
    sourceId, title, servings: 4, minutes: 25, difficulty: 'easy', mealSlots: ['lunch', 'dinner'], cuisineId: 'american', flavorTags: ['comfort'],
    ingredients: labels.map((label) => ({ label, value: 400, unit: 'g' as const })), steps: ['Mezcla todo.', 'Hornea 20 minutos.'], perServing: { kcal: 620, proteinG: 30, carbsG: 70, fatG: 24 },
  });
  const OUT: EstimatedRecipe[] = [
    estimate(1, 'Guiso de garbanzos', ['Garbanzos', 'Tomate', 'Sal']),
    estimate(2, 'Macarrones con queso', ['Macarrones', 'Queso cheddar', 'Leche']),
    estimate(3, 'Pan sin avisar', ['Banano', 'Azúcar']), // el original lleva nueces y harina
  ];
  const estimator: RecipeEstimator = { estimate: async (docs) => OUT.filter((o) => docs.some((d) => d._id === o.sourceId)) };
  const library = (e: RecipeEstimator | null = estimator) =>
    new RecipeLibraryService(app.container.pg.db, new RecipeLibraryRepository(app.container.mongo.rawRecipes), app.container.repos.recipes, app.container.services.catalog, e, app.container.log);

  beforeAll(async () => {
    await resetDatabases();
    app = await testApp();
    const raw = (_id: number, title: string, ingredients: string[]) => ({ _id, title, ingredients, ner: [], nIngredients: 4, directions: ['Mix.', 'Bake.'] });
    await app.container.mongo.rawRecipes.insertMany([
      raw(0, 'Too short', []),
      raw(1, 'Chickpea stew', ['2 c. chickpeas', '1 tomato']),
      raw(2, 'Mac and cheese', ['1 lb. macaroni', '2 c. cheddar cheese', '1 c. milk']),
      raw(3, 'Banana bread', ['2 bananas', '1 c. flour', '1/2 c. walnuts']),
      { ...raw(4, 'Long', []), nIngredients: 25 },
    ].map((r) => (r._id === 0 ? { ...r, directions: ['Mix.'] } : r)));
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

  it('importa hasta el tope, descarta la que perdió alérgenos y no repite', async () => {
    expect(await library(null).importBatch(10)).toBe(0);
    expect(await library().importBatch(0)).toBe(0);
    for (let i = 0; i < 12; i++) await library().importBatch(10);
    expect(await app.container.repos.recipes.countLibrary()).toBe(2);
    expect(await app.container.repos.recipes.byId('rcp_lib_3')).toBeNull();
    expect(await library().importBatch(2)).toBe(0);
  });

  it('salen en las recomendaciones con macros estimados y respetan la dieta', async () => {
    const omni = await ideas('omni', '&slot=lunch');
    expect(omni.find((r) => r.id === 'rcp_lib_2')).toMatchObject({ nutritionPerServing: { kcal: 620, proteinG: 30, carbsG: 70, fatG: 24 }, nutritionEstimated: true });
    expect(omni.find((r) => !r.id.startsWith('rcp_lib_')).nutritionEstimated).toBe(false);
    const vegan = (await ideas('vegan')).map((r) => r.id);
    expect(vegan).toContain('rcp_lib_1');
    expect(vegan).not.toContain('rcp_lib_2');
    expect((await ideas('omni')).every((r) => r.nutritionPerServing.kcal > 0)).toBe(true);
  });

  it('se pueden abrir, cocinar, registrar y mandar a la lista', async () => {
    const api = users.omni!;
    const d = (await api.get('/recipes/rcp_lib_1?servings=2')).body.data;
    expect(d).toMatchObject({ title: 'Guiso de garbanzos', nutritionPerServing: { kcal: 620 }, stepsCount: 2, author: { type: 'noshy' } });
    expect(d.ingredients[0]).toMatchObject({ label: 'Garbanzos', ingredientId: expect.stringMatching(/^txt_/), quantity: { value: 200, unit: 'g' } });
    const list = await api.post('/me/shopping-lists/current/recipes', { recipeId: 'rcp_lib_1' });
    expect(list.status, JSON.stringify(list.body)).toBeLessThan(300);
    expect((await api.get('/me/shopping-lists/current')).status).toBe(200);
    const cook = await api.post('/me/cooking-sessions', { recipeId: 'rcp_lib_1', servings: 2 });
    expect(cook.status, JSON.stringify(cook.body)).toBe(201);
    expect(cook.body.data.steps).toHaveLength(2);
    await api.post(`/me/cooking-sessions/${cook.body.data.id}/abandon`, { atStepIndex: 0, reason: 'later' });
    // No ensucian el buscador.
    expect((await api.get('/catalog/ingredients/search?q=garbanzos')).body.data.filter((i: any) => i.id.startsWith('txt_'))).toEqual([]);
  });

  it('la API ve lo que importó otro proceso', async () => {
    const other = await testApp();
    try {
      await app.container.mongo.rawRecipes.insertOne({ _id: 5, title: 'Lentil soup', ingredients: ['lentils'], ner: [], nIngredients: 4, directions: ['Boil.', 'Serve.'] });
      const worker = new RecipeLibraryService(other.container.pg.db, new RecipeLibraryRepository(other.container.mongo.rawRecipes), other.container.repos.recipes, other.container.services.catalog, { estimate: async () => [estimate(5, 'Sopa de lentejas', ['Lenteja pardina', 'Cilantro'])] }, other.container.log);
      for (let i = 0; i < 20 && !(await app.container.repos.recipes.byId('rcp_lib_5')); i++) await worker.importBatch(10);
      expect((await ideas('vegan')).map((r) => r.id)).toContain('rcp_lib_5');
    } finally {
      await other.close();
    }
  });

  it('👎 a una idea la quita de las recomendaciones; un 👍 posterior la devuelve', async () => {
    const api = users.omni!;
    const m = (await api.post('/me/chef/threads/main/messages', { clientMessageId: 'libtest01', input: { type: 'text', text: 'dame una idea', via: 'keyboard' } })).body.data.chefMessage;
    const card = m.blocks.find((b: any) => b.type === 'recipeCard');
    expect((await ideas('omni')).map((r) => r.id)).toContain(card.recipe.id);
    await api.post(`/me/chef/messages/${m.id}/feedback`, { blockId: card.id, rating: 'down' });
    await drain(app);
    expect((await ideas('omni')).map((r) => r.id)).not.toContain(card.recipe.id);
    expect((await ideas('vegan')).length).toBeGreaterThan(0);
    await api.post(`/me/chef/messages/${m.id}/feedback`, { blockId: card.id, rating: 'up' });
    await drain(app);
    expect((await ideas('omni')).map((r) => r.id)).toContain(card.recipe.id);
  });
});
