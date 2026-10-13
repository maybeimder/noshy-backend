// Contra el Mongo real del catálogo (solo lectura). Se salta si no hay MONGO_URL.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { searchTerms } from '../../../modules/food/food-catalog.port';
import { browseLibraryRecipes, resolveFoodByName, searchFoods } from '../../../modules/food/food.service';
import { MongoFoodCatalog } from './mongo-food-catalog';
import { checkFoodIndexes, MongoConnection } from './mongo.connection';

const skip = process.env.MONGO_URL ? false : 'MONGO_URL no definido';
const connection = process.env.MONGO_URL ? new MongoConnection(process.env.MONGO_URL) : undefined;
const catalog = connection ? new MongoFoodCatalog(connection.db()) : undefined;

after(() => connection?.close());

test('live: the dropdown ranks real chicken first, not sausages or chips', { skip }, async () => {
  const result = await searchFoods(catalog!, { q: 'pollo', limit: 5 });
  assert.ok(result.ok);
  console.log('pollo ->', result.data.map((item) => `${item.exactMatch ? '✓' : ' '} ${item.name} [${item.brand}]`));
  assert.ok(result.data[0].exactMatch);
  assert.doesNotMatch(result.data[0].name, /salchicha|sabor|nuggets/i);

  const pick = await resolveFoodByName(catalog!, 'pimienta');
  assert.doesNotMatch(pick?.name ?? '', /man[ií]/i);
});

test('live: nutrition facts and detail of a found product', { skip }, async () => {
  const [first] = await catalog!.findProductCandidates(searchTerms('arroz'), 1);
  const [facts] = await catalog!.getNutritionFacts([first.id]);
  assert.equal(facts.id, first.id);
  assert.ok(facts.servings.length > 0);
  assert.equal((await catalog!.getProduct(first.id))?.id, first.id);
});

test('live: the recipe library finds references by ner', { skip }, async () => {
  const recipes = await catalog!.searchLibraryRecipes(['rice', 'chicken'], { limit: 5 });
  assert.ok(recipes.length > 0);
  assert.ok(recipes.every((recipe) => recipe.ner.includes('rice') && recipe.ner.includes('chicken')));
  const [full] = await catalog!.getLibraryRecipes([recipes[0].id]);
  assert.ok(full.directions.length > 0);
  console.log('rice + chicken ->', recipes.map((recipe) => `${recipe.id} ${recipe.title} (+${recipe.extraIngredients})`));
});

test('live: paginated browse (random, recent, filtered) over 2.2M recipes stays fast', { skip }, async () => {
  const timed = async (label: string, input: Parameters<typeof browseLibraryRecipes>[1]) => {
    const started = Date.now();
    const result = await browseLibraryRecipes(catalog!, input);
    assert.ok(result.ok, label);
    console.log(`${label}: ${Date.now() - started} ms ->`, result.data.items.slice(0, 3).map((item) => `${item.id} ${item.title}`));
    return result.data;
  };
  const warm = Date.now();
  await catalog!.warmUp();
  console.log(`warmUp: ${Date.now() - warm} ms`);
  const random = await timed('random', { sort: 'random', limit: 20 });
  assert.equal(random.items.length, 20);
  const next = await timed('random, page 2', { sort: 'random', limit: 20, cursor: random.nextCursor! });
  assert.ok(next.items[0].id > random.items.at(-1)!.id || next.items[0].id < random.items[0].id);

  const recent = await timed('recent', { sort: 'recent', limit: 20 });
  assert.equal(recent.items[0].id, 2231141);
  const filtered = await timed('oldest Recipes1M <= 5 ingredients', { sort: 'oldest', limit: 20, source: 'Recipes1M', maxIngredients: 5 });
  assert.ok(filtered.items.every((item) => item.source === 'Recipes1M' && item.nIngredients <= 5));
  const randomFiltered = await timed('random Recipes1M', { sort: 'random', limit: 20, source: 'Recipes1M' });
  assert.ok(randomFiltered.items.every((item) => item.source === 'Recipes1M'));
});

test('live: the expected indexes exist', { skip }, async () => {
  const warnings = await checkFoodIndexes(connection!.db());
  if (warnings.length > 0) console.warn(warnings.join('\n'));
  assert.ok(true);
});
