// Contra el Mongo real del catálogo (solo lectura). Se salta si no hay MONGO_URL.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { searchTerms } from '../../../modules/food/food-catalog.port';
import { MongoFoodCatalog } from './mongo-food-catalog';
import { checkFoodIndexes, MongoConnection } from './mongo.connection';

const skip = process.env.MONGO_URL ? false : 'MONGO_URL no definido';
const connection = process.env.MONGO_URL ? new MongoConnection(process.env.MONGO_URL) : undefined;
const catalog = connection ? new MongoFoodCatalog(connection.db()) : undefined;

after(() => connection?.close());

test('live: the dropdown finds "arroz" with the generic first', { skip }, async () => {
  const items = await catalog!.searchProducts(searchTerms('arroz'), 10);
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.baseServing.grams > 0));
  console.log('arroz ->', items.slice(0, 5).map((item) => `${item.id} ${item.name} [${item.brand}${item.state ? `, ${item.state}` : ''}]`));
});

test('live: nutrition facts and detail of a found product', { skip }, async () => {
  const [first] = await catalog!.searchProducts(searchTerms('arroz'), 1);
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

test('live: the expected indexes exist', { skip }, async () => {
  const warnings = await checkFoodIndexes(connection!.db());
  if (warnings.length > 0) console.warn(warnings.join('\n'));
  assert.ok(true);
});
