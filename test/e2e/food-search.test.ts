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
    // Foto solo si el producto la trae y es https.
    expect(r.map((i) => i.imageUrl)).toEqual([expect.stringContaining('openfoodfacts'), null, null]);
    expect((await search('arroz'))[0]).toMatchObject({ id: 'ing_rice', imageUrl: null });
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

  it('sinónimos: la palabra del usuario aunque el catálogo la llame distinto', async () => {
    expect((await search('palta')).map((i) => i.id)).toContain('ing_avocado');
    expect((await search('banana')).map((i) => i.id)).toContain('ing_banana');
    expect((await search('cereales')).map((i) => i.id)).toContain('ing_granola');
    expect(await search('pan con palta')).toEqual([]);
  });

  it('texto libre: se guarda lo que no está en el catálogo, con alérgenos deducidos y sin filtrarse a otros', async () => {
    const r = await api.post('/me/pantry/items', { text: '  chontaduro   de la abuela ', quantity: { value: 3, unit: 'unit' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ label: 'Chontaduro de la abuela', ingredientId: expect.stringMatching(/^txt_[0-9a-f]{24}$/), quantity: { value: 3, unit: 'unit' } });
    expect((await api.post('/me/pantry/items', { text: 'chontaduro de la abuela' })).body.error.code).toBe('ALREADY_IN_PANTRY');
    expect((await api.get('/me/pantry?q=chontaduro')).body.data).toHaveLength(1);
    expect(await search('chontaduro')).toEqual([]);
    // El mismo nombre que un ingrediente base es ese ingrediente: cuenta para las recetas.
    expect((await api.post('/me/pantry/items', { text: 'AGUACATE' })).body.data.ingredientId).toBe('ing_avocado');
    const cheese = await api.post('/me/pantry/items', { text: 'queso de la finca' });
    expect(app.container.services.catalog.facts(cheese.body.data.ingredientId).allergens).toEqual(['lactose']);
    // «Se acabó» → lista de compras, por evento.
    await api.del(`/me/pantry/${r.body.data.id}?addToShoppingList=true`);
    await drain(app);
    const items = (await api.get('/me/shopping-lists/current')).body.data.groups.flatMap((g: any) => g.items);
    expect(items.map((i: any) => i.label)).toContain('Chontaduro de la abuela');
    for (const body of [{}, { text: 'x' }, { text: '1234' }, { text: 'sal', ingredientId: 'ing_salt' }]) expect((await api.post('/me/pantry/items', body)).status).toBe(422);
    expect((await api.post('/me/pantry/items', { text: 'panela rara', productId: 'prd_kikes12' })).status).toBe(422);
  });

  it('productos de un ingrediente con marca, empaque y precio por tienda', async () => {
    const r = await api.get('/catalog/ingredients/ing_pecorino/products?storeId=exito');
    expect(r.status).toBe(200);
    expect(r.body.data).toContainEqual({ id: 'prd_pomona_pecorino150', label: 'Pecorino Romano Pomona', brand: 'Pomona', packLabel: '150 g', price: { amount: 21400, currency: 'COP' } });
    // Plaza solo vende frutas y verduras.
    const plaza = await api.get('/catalog/ingredients/ing_pecorino/products?storeId=plaza');
    expect(plaza.body.data.every((p: any) => p.price === null)).toBe(true);
    const any = await api.get('/catalog/ingredients/ing_pecorino/products');
    expect(any.body.data.find((p: any) => p.brand === 'Pomona').price.amount).toBeLessThan(21400);
    expect((await api.get('/catalog/ingredients/food_7701/products')).body.data).toEqual([]);
    expect((await api.get('/catalog/ingredients/ing_nope/products')).status).toBe(404);
    expect((await api.get('/catalog/ingredients/ing_pecorino/products?storeId=nope')).status).toBe(422);
  });

  it('fotos: PUT binario desde el navegador (CORS) y la URL pública en el mismo dominio', async () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      const up = (await api.post('/media/uploads', { purpose: 'recipeCover', contentType, sizeBytes: 2000 })).body.data;
      const url = new URL(up.uploadUrl);
      const origin = 'https://noshy.example';
      const pre = await app.inject({ method: 'OPTIONS', url: url.pathname, headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' } });
      expect(pre.headers['access-control-allow-methods']).toContain('PUT');
      const put = await app.inject({ method: 'PUT', url: `${url.pathname}${url.search}`, headers: { origin, 'content-type': contentType }, payload: Buffer.alloc(2000, 7) });
      expect([put.statusCode, put.headers['access-control-allow-origin']]).toEqual([200, origin]);
      const pub = new URL(app.container.providers.storage.publicUrl(url.searchParams.get('key')!));
      expect(pub.origin).toBe(url.origin);
      const got = await app.inject({ method: 'GET', url: pub.pathname });
      expect([got.statusCode, got.headers['content-type'], got.headers['cross-origin-resource-policy'], got.rawPayload.length]).toEqual([200, contentType, 'cross-origin', 2000]);
    }
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
