import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { InMemoryEventStore } from '../../core/events/in-memory-event-store';
import { setEventStore } from '../../infrastructure/event-bus/event-bus';
import { createServer } from '../../infrastructure/http/server';
import { normalizeSearchText, searchTerms, type FoodCatalogPort, type LibraryPageQuery, type LibraryRecipeData } from './food-catalog.port';
import type { FoodCandidate, FoodNutritionFacts, FoodProduct } from './food.model';
import type { RecipeWriterContext, RecipeWriterPort } from './recipe-writer.port';
import { escapeRegex } from '../../infrastructure/database/mongo/mongo-food-catalog';

const store = new InMemoryEventStore();
setEventStore(store);

type FakeProduct = FoodProduct & { popularity: number };
const product = (overrides: Partial<FakeProduct> & Pick<FoodProduct, 'id' | 'name'>): FakeProduct => ({
  brand: 'generic',
  isGeneric: true,
  quantity: null,
  per100g: {},
  servings: [{ label: '100 g', grams: 100 }],
  allergens: [],
  traces: [],
  dietTags: [],
  labels: [],
  categories: [],
  foodGroups: [],
  nutrientLevels: [],
  additives: [],
  stores: [],
  image: null,
  popularity: 1,
  ...overrides
});

const PRODUCTS = [
  product({
    id: 'usda:1',
    name: 'Arroz blanco (crudo)',
    state: 'raw',
    pairKey: 'arroz-blanco',
    popularity: 1_000_000,
    per100g: { kcal: 365, protein_g: 7.1, carbs_g: 80, fat_g: 0.7 },
    servings: [{ label: '100 g', grams: 100 }, { label: '1 taza', grams: 185 }]
  }),
  product({
    id: 'usda:2',
    name: 'Arroz blanco (cocido)',
    state: 'cooked',
    pairKey: 'arroz-blanco',
    popularity: 999_999,
    per100g: { kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 }
  }),
  product({ id: '7701', name: 'Arroz Diana', brand: 'diana', isGeneric: false, popularity: 50, per100g: { kcal: 360 } }),
  product({ id: 'usda:3', name: 'Pechuga de pollo (cruda)', state: 'raw', popularity: 10, per100g: { kcal: 120, protein_g: 22.5, fat_g: 2.6 } }),
  // Casos reales del catálogo: lo más popular para "pollo" y "pimienta" eran procesados.
  product({ id: 'off:salchicha', name: 'Salchichas viena de pollo', brand: 'Blony', isGeneric: false, popularity: 70, foodGroups: ['processed-meat'], per100g: { kcal: 250 } }),
  product({ id: 'off:papas', name: 'Margarita Pollo', brand: 'Frito Lay', isGeneric: false, popularity: 40, foodGroups: ['salty-snacks'], per100g: { kcal: 520 } }),
  product({ id: 'off:mani', name: 'Maní Sabor Limón Pimienta', brand: 'Manitoba', isGeneric: false, popularity: 30, foodGroups: ['nuts', 'salty-snacks'], per100g: { kcal: 600 } }),
  product({ id: 'off:pimienta', name: 'Pimienta negra molida', brand: 'Comarrico', isGeneric: false, popularity: 1, per100g: { kcal: 250 } })
];

const LIBRARY: LibraryRecipeData[] = [
  { id: 10, title: 'Chicken Fried Rice', ingredients: ['2 c. rice', '1 lb. chicken'], directions: ['Cook rice.', 'Fry with chicken.'], ner: ['rice', 'chicken', 'egg'], nIngredients: 3 },
  { id: 11, title: 'Plain Rice', ingredients: ['1 c. rice'], directions: ['Boil.'], ner: ['rice', 'water'], nIngredients: 2 },
  // Relleno para la paginación: ids 0..24 continuos, como en recipes_raw.
  ...Array.from({ length: 25 }, (_, id) => id)
    .filter((id) => id !== 10 && id !== 11)
    .map((id) => ({
      id,
      title: `Salt Cake ${id}`,
      ingredients: ['1 tsp. salt'],
      directions: ['Mix.'],
      ner: ['salt'],
      nIngredients: id % 3 === 0 ? 1 : 9,
      source: id % 2 === 0 ? 'Gathered' : 'Recipes1M'
    }))
].sort((left, right) => left.id - right.id);

// Catálogo falso con la misma semántica que el adaptador de Mongo.
class FakeCatalog implements FoodCatalogPort {
  available = true;
  private check() {
    if (!this.available) throw new Error('Mongo caído');
  }
  async findProductCandidates(terms: string[], max: number): Promise<FoodCandidate[]> {
    this.check();
    return PRODUCTS.filter((item) => terms.every((term) => new RegExp(`\\b${escapeRegex(term)}`).test(normalizeSearchText(`${item.name} ${item.brand}`))))
      .sort((left, right) => right.popularity - left.popularity)
      .slice(0, max)
      .map((item) => ({
        id: item.id,
        name: item.name,
        brand: item.brand,
        ...(item.state ? { state: item.state } : {}),
        isGeneric: item.isGeneric,
        image: null,
        kcalPer100g: item.per100g.kcal ?? null,
        baseServing: item.servings[0],
        foodGroups: item.foodGroups,
        nova: null,
        popularity: item.popularity,
        completeness: 0.8
      }));
  }
  async getProduct(id: string) {
    this.check();
    return PRODUCTS.find((item) => item.id === id) ?? null;
  }
  async getNutritionFacts(ids: string[]): Promise<FoodNutritionFacts[]> {
    this.check();
    return PRODUCTS.filter((item) => ids.includes(item.id));
  }
  async searchLibraryRecipes(ingredients: string[], options: { limit: number }) {
    this.check();
    return LIBRARY.filter((recipe) => ingredients.every((name) => recipe.ner.includes(name)))
      .slice(0, options.limit)
      .map((recipe) => ({ id: recipe.id, title: recipe.title, ner: recipe.ner, nIngredients: recipe.nIngredients, extraIngredients: recipe.ner.length - ingredients.length }));
  }
  async getLibraryRecipes(ids: number[]) {
    this.check();
    return LIBRARY.filter((recipe) => ids.includes(recipe.id));
  }
  async listLibraryRecipes(query: LibraryPageQuery) {
    this.check();
    const { gt, gte, lt } = query.idRange;
    const rows = LIBRARY.filter(
      (recipe) =>
        (gt === undefined || recipe.id > gt) &&
        (gte === undefined || recipe.id >= gte) &&
        (lt === undefined || recipe.id < lt) &&
        (!query.source || recipe.source === query.source) &&
        (!query.maxIngredients || recipe.nIngredients <= query.maxIngredients)
    );
    return (query.order === 'asc' ? rows : [...rows].reverse())
      .slice(0, query.limit)
      .map(({ id, title, ner, nIngredients, source }) => ({ id, title, ner, nIngredients, ...(source ? { source } : {}) }));
  }
  async maxLibraryRecipeId() {
    return LIBRARY.at(-1)!.id;
  }
}

class FakeWriter implements RecipeWriterPort {
  contexts: RecipeWriterContext[] = [];
  translations = 0;
  async translateIngredients(names: string[]) {
    this.translations++;
    const dictionary: Record<string, string> = { arroz: 'rice', pollo: 'chicken' };
    return names.map((name) => dictionary[name] ?? name);
  }
  async writeRecipe(context: RecipeWriterContext) {
    this.contexts.push(context);
    return {
      title: 'Arroz con pollo',
      servings: 2,
      ingredients: [
        { name: 'Arroz', grams: 200, foodId: 'usda:1' },
        { name: 'Pollo', grams: 300 },
        { name: 'Polvo de hadas', grams: 5 }
      ],
      steps: ['Cocina el arroz.', 'Agrega el pollo.'],
      mealType: 'almuerzo' as const
    };
  }
}

const catalog = new FakeCatalog();
const writer = new FakeWriter();

async function withApi(run: (call: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const server = createServer({ foodCatalog: catalog, recipeWriter: writer }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const register = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Food', email: `food-${Math.random()}@noshy.com`, password: 'StrongPass1!' })
    });
    const { token } = await register.json();
    await run(async (path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('search terms are normalized like products_slim.search, without connectors, and regex input is escaped', () => {
  assert.deepEqual(searchTerms('  Árroz BLANCO, arroz '), ['arroz', 'blanco']);
  assert.deepEqual(searchTerms('aceite de oliva'), ['aceite', 'oliva']);
  assert.deepEqual(searchTerms('...'), []);
  assert.equal(escapeRegex('a.*(b)'), 'a\\.\\*\\(b\\)');
});

test('dropdown search: ranked by relevance, not popularity; state is always shown', async () => {
  await withApi(async (call) => {
    const all = await call('/food/products?q=arroz');
    assert.equal(all.status, 200);
    assert.deepEqual(new Set(all.body.map((item: any) => item.id)), new Set(['usda:1', 'usda:2', '7701']));
    assert.ok(all.body.every((item: any) => item.exactMatch));
    assert.equal(all.body.find((item: any) => item.id === 'usda:2').state, 'cooked');

    // Las salchichas y las papas "sabor pollo" son más populares, pero la pechuga ES pollo.
    const chicken = await call('/food/products?q=pollo');
    assert.equal(chicken.body[0].id, 'usda:3');
    assert.deepEqual(
      chicken.body.filter((item: any) => !item.exactMatch).map((item: any) => item.id).sort(),
      ['off:papas', 'off:salchicha']
    );

    const pepper = await call('/food/products?q=pimienta');
    assert.deepEqual(pepper.body.map((item: any) => item.id), ['off:pimienta', 'off:mani']);
    assert.equal(pepper.body[1].exactMatch, false);

    const narrowed = await call('/food/products?q=arroz%20cocido&limit=5');
    assert.deepEqual(narrowed.body.map((item: any) => item.id), ['usda:2']);

    assert.deepEqual((await call('/food/products?q=xyzw')).body, []);
    assert.equal((await call('/food/products?q=a')).status, 400);
    // Operadores de Mongo en la query string se rechazan en el DTO.
    assert.equal((await call('/food/products?q[$ne]=x')).status, 400);
  });
});

test('product detail and 404 for unknown ids', async () => {
  await withApi(async (call) => {
    const found = await call('/food/products/usda:1');
    assert.equal(found.status, 200);
    assert.equal(found.body.per100g.kcal, 365);
    assert.equal((await call('/food/products/nope')).status, 404);
  });
});

test('macros: grams, servings and the 100 g default; logging is opt-in and event sourced', async () => {
  await withApi(async (call) => {
    const preview = await call('/food/macros', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { foodId: 'usda:1', grams: 50 },
          { foodId: 'usda:1', serving: '1 Taza', quantity: 2 },
          { foodId: 'usda:3' }
        ]
      })
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.items.map((line: any) => line.grams), [50, 370, 100]);
    assert.equal(preview.body.items[0].nutrients.kcal, 182.5);
    assert.equal(preview.body.items[1].nutrients.kcal, 1350.5);
    assert.equal(preview.body.totals.kcal, 182.5 + 1350.5 + 120);
    assert.equal(preview.body.totals.fiber_g, null);
    assert.ok(preview.body.items[2].missing.includes('carbs_g'));
    assert.match(preview.body.warnings[0], /100 g/);
    assert.equal(preview.body.mealId, undefined);

    const badServing = await call('/food/macros', { method: 'POST', body: JSON.stringify({ items: [{ foodId: 'usda:1', serving: '1 plato' }] }) });
    assert.equal(badServing.status, 422);
    const unknown = await call('/food/macros', { method: 'POST', body: JSON.stringify({ items: [{ foodId: 'nope', grams: 10 }] }) });
    assert.equal(unknown.status, 404);

    const logged = await call('/food/macros', {
      method: 'POST',
      body: JSON.stringify({ items: [{ foodId: 'usda:3', grams: 150 }], log: true, label: 'Almuerzo' })
    });
    assert.ok(logged.body.mealId);
    assert.ok(store.readAll().some((event) => event.type === 'food.meal_logged'));

    const history = await call('/food/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.meals.length, 1);
    assert.equal(history.body.meals[0].label, 'Almuerzo');
    assert.equal(history.body.meals[0].totals.kcal, 180);
  });
});

test('library search translates ingredients (cached) and ranks by extra ingredients', async () => {
  await withApi(async (call) => {
    const before = writer.translations;
    const found = await call('/food/library/recipes?ingredients=arroz,%20pollo');
    assert.equal(found.status, 200);
    assert.deepEqual(found.body.searchedIngredients, ['rice', 'chicken']);
    assert.deepEqual(found.body.recipes.map((recipe: any) => recipe.id), [10]);
    assert.deepEqual(found.body.recipes[0].tags.proteins, ['pollo', 'huevo']);

    await call('/food/library/recipes?ingredients=pollo');
    assert.equal(writer.translations, before + 1, 'pollo ya estaba traducido');

    const detail = await call('/food/library/recipes/10');
    assert.equal(detail.body.title, 'Chicken Fried Rice');
    assert.deepEqual(detail.body.tags.allergens, ['huevo']);
    assert.deepEqual(detail.body.tags.diet, []);
    assert.deepEqual(detail.body.tags.effort, ['pocos ingredientes', 'rápida']);
    assert.equal((await call('/food/library/recipes/abc')).status, 404);
  });
});

test('library browse: a random page by default; following the cursors visits every recipe exactly once', async () => {
  await withApi(async (call) => {
    const first = await call('/food/library/browse');
    assert.equal(first.status, 200);
    assert.equal(first.body.sort, 'random');
    assert.equal(first.body.items.length, 20);
    const card = first.body.items[0];
    assert.equal(card.image, null);
    assert.ok(card.tags && Array.isArray(card.tags.allergens));
    assert.equal(card.directions, undefined, 'el listado no trae los pasos');

    // Recorrido completo con páginas de 7: incluye la vuelta al principio de la colección.
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: number }[]; nextCursor: string | null } } = await call(
        `/food/library/browse?limit=7${cursor ? `&cursor=${cursor}` : ''}`
      );
      seen.push(...page.body.items.map((item) => item.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 25);
    assert.deepEqual([...seen].sort((left, right) => left - right), Array.from({ length: 25 }, (_, id) => id));
  });
});

test('library browse: recent / oldest order by dataset id, with filters, and bad cursors are rejected', async () => {
  await withApi(async (call) => {
    const recent = await call('/food/library/browse?sort=recent&limit=3');
    assert.deepEqual(recent.body.items.map((item: any) => item.id), [24, 23, 22]);
    const next = await call(`/food/library/browse?limit=3&cursor=${recent.body.nextCursor}`);
    assert.deepEqual(next.body.items.map((item: any) => item.id), [21, 20, 19]);

    const oldest = await call('/food/library/browse?sort=oldest&limit=4&source=Gathered&maxIngredients=3');
    assert.deepEqual(oldest.body.items.map((item: any) => item.id), [0, 6, 12, 18]);
    const end = await call(`/food/library/browse?limit=4&source=Gathered&maxIngredients=3&cursor=${oldest.body.nextCursor}`);
    assert.deepEqual(end.body.items.map((item: any) => item.id), [24]);
    assert.equal(end.body.nextCursor, null);

    assert.equal((await call('/food/library/browse?cursor=no-es-un-cursor')).status, 400);
    assert.equal((await call('/food/library/browse?limit=51')).status, 400);
    assert.equal((await call('/food/library/browse?sort=title')).status, 400);
  });
});

test('RAG generation: references go to the writer, the back computes macros and records the event', async () => {
  await withApi(async (call) => {
    const generated = await call('/food/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({ ingredients: [{ name: 'arroz', foodId: 'usda:1', grams: 200 }, { name: 'pollo' }], servings: 2 })
    });
    assert.equal(generated.status, 201);
    const { recipe, references, recipeInput } = generated.body;

    // Contexto RAG: las recetas de referencia en inglés llegaron al modelo. Primero la que tiene
    // todos los ingredientes; luego se relaja la búsqueda (solo "rice") para completar referencias.
    assert.deepEqual(writer.contexts.at(-1)!.references.map((reference) => reference.id), [10, 11]);
    assert.deepEqual(references.map((reference: any) => reference.id), [10, 11]);

    // "Pollo" sin foodId se cruzó con la pechuga (no con las salchichas, más populares); lo que no existe no suma.
    assert.equal(recipe.ingredients[1].foodId, 'usda:3');
    assert.equal(recipe.ingredients[2].foodId, null);
    assert.match(recipe.warnings[0], /Polvo de hadas/);
    assert.equal(recipe.macros.total.kcal, 730 + 360);
    assert.equal(recipe.macros.perServing.kcal, (730 + 360) / 2);
    assert.deepEqual(recipeInput.ingredients[0], { name: 'Arroz', quantity: 200, unit: 'g' });

    // Tags: deducidos de ingredientes, tipo de comida del modelo y macros por porción.
    assert.deepEqual(recipe.tags.proteins, ['pollo']);
    assert.deepEqual(recipe.tags.mealTypes, ['almuerzo']);
    assert.ok(recipe.tags.nutrition.includes('alto en proteína'));
    assert.deepEqual(recipe.tags.diet, []);

    const history = await call('/food/history');
    assert.equal(history.body.recipes[0].id, recipe.id);
    const again = await call(`/food/recipes/${recipe.id}`);
    assert.equal(again.body.recipe.title, 'Arroz con pollo');
    assert.equal((await call('/food/recipes/nope')).status, 404);
  });
});

test('Mongo down or not configured -> 503, never a crash', async () => {
  catalog.available = false;
  try {
    await withApi(async (call) => {
      const response = await call('/food/products?q=arroz');
      assert.equal(response.status, 503);
      assert.equal(response.body.code, 'FOOD_CATALOG_UNAVAILABLE');
    });
  } finally {
    catalog.available = true;
  }

  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { token } = await (
      await fetch(`${base}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NoMongo', email: 'no-mongo@noshy.com', password: 'StrongPass1!' })
      })
    ).json();
    const response = await fetch(`${base}/food/products?q=arroz`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('food endpoints require a token', async () => {
  const server = createServer({ foodCatalog: catalog }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/food/products?q=arroz`);
    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
