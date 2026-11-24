import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MongoClient } from 'mongodb';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';
import { CatalogService, FoodRepository, type FoodRepository as Foods } from '../../src/modules/catalog/index.js';

/** «Añadir ingrediente»: las recomendaciones salen de products_slim (Mongo) y se pueden guardar. */
describe('buscador de ingredientes sobre Mongo', () => {
  let app: FastifyInstance;
  let api: ReturnType<typeof client>;
  const search = async (q: string, limit = 10) => (await api.get(`/catalog/ingredients/search?q=${encodeURIComponent(q)}&limit=${limit}`)).body.data as any[];

  beforeAll(async () => {
    await resetDatabases();
    app = await testApp();
    api = client(app);
    const r = await api.post('/auth/register', { name: 'Diana', email: 'diana3@correo.co', password: 'supersecreta', acceptedTermsVersion: '2026-09' });
    api.setToken(r.body.data.tokens.accessToken);
    await api.post('/me/onboarding/complete', ONBOARDING_PAYLOAD);
    await drain(app);
  });
  afterAll(async () => app?.close());

  it('recomienda alimentos que solo están en Mongo, por relevancia y con choques', async () => {
    const r = await search('quínua');
    expect(r.map((i) => i.id)).toEqual(['food_7701', 'food_usda:1', 'food_7702']);
    expect(r[0]).toMatchObject({ label: 'Quinua en grano · Nutrilón', defaultUnit: 'g', conflicts: [] });
    expect(r[2].conflicts).toContainEqual({ id: 'lactose', label: 'Lactosa' });
    expect((await search('quinuas')).length).toBe(3);
    expect((await search('qui')).length).toBeGreaterThan(0);
    expect(await search('.*')).toEqual([]);
  });

  it('los ingredientes base van primero, sin repetidos y sin llenar la lista', async () => {
    const crema = await search('crema de leche');
    expect(crema[0].id).toBe('ing_cream');
    expect(crema.map((i) => i.id)).toEqual(['ing_cream', 'food_7705']);
    const arroz = await search('arroz');
    expect(arroz[0].id).toBe('ing_rice');
    expect(arroz).toHaveLength(10);
  });

  it('agrega un alimento de Mongo a la despensa (y solo uno)', async () => {
    const bad = await api.post('/me/pantry/items', { ingredientId: 'food_usda:1', quantity: { value: 1, unit: 'clove' } });
    expect(bad.body.error.details[0].code).toBe('INVALID_UNIT');
    const r = await api.post('/me/pantry/items', { ingredientId: 'food_usda:1', quantity: { value: 2, unit: 'cup' } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ ingredientId: 'food_usda:1', label: 'Quinua (cruda)', storage: 'pantry', quantity: { value: 2, unit: 'cup' } });
    expect((await api.post('/me/pantry/items', { ingredientId: 'food_usda:1' })).body.error.code).toBe('ALREADY_IN_PANTRY');
    expect((await api.get('/me/pantry?q=quinua')).body.data).toHaveLength(1);
    const unknown = await api.post('/me/pantry/items', { ingredientId: 'food_nope' });
    expect(unknown.status).toBe(422);
    // Ya copiado a Postgres, sale una sola vez.
    expect((await search('quinua')).filter((i) => i.id === 'food_usda:1')).toHaveLength(1);
  });

  it('sirve igual en la lista de compras y al crear recetas', async () => {
    await drain(app);
    const list = await api.get('/me/shopping-lists/current');
    const add = await api.post(`/me/shopping-lists/current/items`, { items: [{ ingredientId: 'food_7701' }] });
    expect(add.status, JSON.stringify(add.body)).toBeLessThan(300);
    expect(list.status).toBe(200);
    const after = await api.get('/me/shopping-lists/current');
    expect(after.body.data.groups.flatMap((g: any) => g.items).map((i: any) => i.ingredientId)).toContain('food_7701');
    const draft = await api.post('/me/recipes', { title: 'Quinua al curry' });
    const patched = await api.patch(`/me/recipes/${draft.body.data.id}`, { servings: 1, ingredients: [{ ingredientId: 'food_usda:1', quantity: { value: 100, unit: 'g' } }] });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.nutritionPerServing.kcal).toBe(368);
  });

  it('otro proceso (worker) se entera por Postgres; las búsquedas internas siguen solo con los base', async () => {
    const { repos, services } = app.container;
    const worker = await new CatalogService(repos.catalog, repos.foods).ready();
    await services.catalog.ensure(['food_arroz3']);
    expect(worker.hasIngredient('food_arroz3')).toBe(false);
    await worker.sync();
    expect(worker.hasIngredient('food_arroz3')).toBe(true);
    expect(services.catalog.search('arroz', 10).map((i) => i.id)).toEqual(['ing_rice']);
  });

  it('copias simultáneas del mismo alimento no chocan', async () => {
    const { repos } = app.container;
    const [a, b] = await Promise.all([0, 1].map(() => new CatalogService(repos.catalog, repos.foods).ready()));
    await Promise.all([a!.ensure(['food_arroz7']), b!.ensure(['food_arroz7']), a!.ensure(['food_arroz7'])]);
    expect([a!, b!].every((c) => c.hasIngredient('food_arroz7'))).toBe(true);
    expect(await repos.catalog.ingredientCount()).toBe((a as any).s.ingredients.length);
  });

  it('con Mongo caído responde rápido con lo local y no deja guardar a medias', async () => {
    const dead = new MongoClient('mongodb://127.0.0.1:1');
    const down = new FoodRepository(dead.db('x').collection('products_slim') as never);
    const svc = app.container.services.ingredientSearch as unknown as { foods: Foods };
    const cat = app.container.services.catalog as unknown as { foods: Foods };
    const live = svc.foods;
    svc.foods = cat.foods = down;
    try {
      const t = Date.now();
      expect((await search('quinua')).map((i) => i.id).sort()).toEqual(['food_7701', 'food_usda:1']);
      expect(Date.now() - t).toBeLessThan(5_000);
      const r = await api.post('/me/pantry/items', { ingredientId: 'food_7702' });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('FOOD_CATALOG_UNAVAILABLE');
    } finally {
      svc.foods = cat.foods = live;
      await dead.close();
    }
  });
});
