import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterRecipeWriter } from './openrouter-recipe-writer';

function fakeFetch(content: string) {
  const bodies: any[] = [];
  const fn = (async (_url: string | URL, init: RequestInit = {}) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return { fn, bodies };
}

test('translation keeps order and length and lowercases', async () => {
  const { fn, bodies } = fakeFetch('{"ingredients":["Chicken","rice"]}');
  const english = await new OpenRouterRecipeWriter({ apiKey: 'k', fetch: fn }).translateIngredients(['pollo', 'arroz']);
  assert.deepEqual(english, ['chicken', 'rice']);
  assert.equal(bodies[0].temperature, 0);

  const short = fakeFetch('{"ingredients":["chicken"]}');
  await assert.rejects(new OpenRouterRecipeWriter({ apiKey: 'k', fetch: short.fn }).translateIngredients(['pollo', 'arroz']));
});

test('the written recipe is validated and the references reach the prompt', async () => {
  const { fn, bodies } = fakeFetch(
    '```json\n{"title":"Arroz con pollo","servings":"2","ingredients":[{"name":"Arroz","grams":200,"foodId":"usda:1"},{"name":"Sal","grams":2,"foodId":null}],"steps":["Cocina."]}\n```'
  );
  const recipe = await new OpenRouterRecipeWriter({ apiKey: 'k', fetch: fn }).writeRecipe({
    ingredients: [{ name: 'arroz', foodId: 'usda:1', grams: 200 }],
    references: [{ id: 1, title: 'Chicken Rice', ingredients: ['1 c. rice'], directions: ['Boil.'], ner: ['rice'], nIngredients: 1 }],
    servings: 2
  });
  assert.deepEqual(recipe.ingredients, [{ name: 'Arroz', grams: 200, foodId: 'usda:1' }, { name: 'Sal', grams: 2 }]);
  assert.equal(recipe.servings, 2);
  assert.match(bodies[0].messages[1].content, /Chicken Rice/);

  const invalid = fakeFetch('{"title":"Sin pasos","servings":1,"ingredients":[],"steps":[]}');
  await assert.rejects(new OpenRouterRecipeWriter({ apiKey: 'k', fetch: invalid.fn }).writeRecipe({ ingredients: [], references: [], servings: 1 }));
});

test('live: a free model translates Spanish ingredients to RecipeNLG names', { skip: process.env.OPENROUTER_API_KEY ? false : 'OPENROUTER_API_KEY no definido' }, async () => {
  const writer = new OpenRouterRecipeWriter({ apiKey: process.env.OPENROUTER_API_KEY!, timeoutMs: 90_000 });
  const english = await writer.translateIngredients(['pollo', 'arroz', 'cebolla']);
  console.log('pollo, arroz, cebolla ->', english);
  assert.equal(english.length, 3);
  assert.ok(english.includes('chicken') || english.some((name) => name.includes('chicken')));
});
