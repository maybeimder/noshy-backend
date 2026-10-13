// Casos tomados del catálogo real (products_slim), donde ordenar por popularidad fallaba.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankFoods, sameWord } from './food-ranking';
import { inferRecipeTags } from './food-tags';
import type { FoodCandidate } from './food.model';

const candidate = (id: string, name: string, overrides: Partial<FoodCandidate> = {}): FoodCandidate => ({
  id,
  name,
  brand: 'generic',
  isGeneric: false,
  image: null,
  kcalPer100g: null,
  baseServing: { label: '100 g', grams: 100 },
  foodGroups: [],
  nova: null,
  popularity: 0,
  completeness: 0.5,
  ...overrides
});

const best = (terms: string[], candidates: FoodCandidate[]) => rankFoods(terms, candidates).filter((item) => item.reliable).map((item) => item.id);

test('whole words with plurals, not prefixes: "sal" is not "salchicha", "ajo" is not "ajonjolí"', () => {
  assert.ok(sameWord('pimientas', 'pimienta'));
  assert.ok(sameWord('frijoles', 'frijol'));
  assert.ok(sameWord('nueces', 'nuez'));
  assert.ok(!sameWord('salchicha', 'sal'));
  assert.ok(!sameWord('ajonjoli', 'ajo'));

  const salt = [
    candidate('salchicha', 'Salchicha', { brand: 'Ranchera', popularity: 9 }),
    candidate('salmon', 'Salmón Ahumado', { popularity: 5 }),
    candidate('sal', 'Sal Alta Pureza', { brand: 'Refisal' })
  ];
  assert.deepEqual(best(['sal'], salt), ['sal']);
  assert.deepEqual(best(['ajo'], [candidate('ajonjoli', 'Ajonjolí', { popularity: 20 })]), []);
});

test('the searched food as a flavor, a side or inside a processed product is never a reliable match', () => {
  const chicken = [
    candidate('salchicha', 'Salchichas viena de pollo', { brand: 'Blony', popularity: 7, foodGroups: ['processed-meat'] }),
    candidate('chips', 'Margarita Pollo', { brand: 'Frito Lay', popularity: 4 }),
    candidate('ramen', 'Ramen sabor a Pollo', { brand: 'Nissin', popularity: 1, nova: 4 }),
    candidate('nuggets', 'Nuggets de Pollo Apanados', { brand: 'Frescampo', popularity: 2 }),
    candidate('pechuga', 'Pechuga De Pollo', { brand: 'Taeq' })
  ];
  assert.deepEqual(best(['pollo'], chicken), ['pechuga']);
  assert.equal(rankFoods(['pollo'], chicken)[0].id, 'pechuga');

  const pepper = [
    candidate('mani', 'Manitoba Maní Sabor Limón Pimienta', { brand: 'Manitoba', popularity: 3, foodGroups: ['nuts', 'salty-snacks'] }),
    candidate('pavo', 'Pechuga De Pavo A La Pimienta', { brand: 'Delipavo' }),
    candidate('pimienta', 'Pimienta Comarrico Picante', { brand: 'Comarrico' })
  ];
  assert.deepEqual(best(['pimienta'], pepper), ['pimienta']);

  const sugar = [
    candidate('brownie', 'Brownie Chocolov Cero Azúcar', { brand: 'Chocolov', popularity: 9 }),
    candidate('avena', 'Avena Sin Azucar', { brand: 'Hatsu', popularity: 9 }),
    candidate('azucar', 'Azúcar', { brand: 'Providencia', foodGroups: ['sweets'] })
  ];
  assert.deepEqual(best(['azucar'], sugar), ['azucar']);

  // Mezclas: "Arveja zanahoria y maíz" no es zanahoria.
  assert.deepEqual(best(['zanahoria'], [candidate('mix', 'Arveja Zanahoria y maiz', { brand: 'Aburra' })]), []);
});

test('tags: allergens, diet, proteins and meal types from ner or Spanish names', () => {
  const cookies = inferRecipeTags({ title: 'No-Bake Nut Cookies', ingredients: ['brown sugar', 'milk', 'vanilla', 'nuts', 'butter'], steps: 3 });
  assert.deepEqual(cookies.allergens, ['frutos secos', 'leche']);
  assert.deepEqual(cookies.diet, ['vegetariana']);
  assert.deepEqual(cookies.mealTypes, ['postre']);
  assert.deepEqual(cookies.effort, ['pocos ingredientes', 'rápida']);

  // "peanut butter" y "coconut milk" no son lácteos; "chicken pot pie" no es un postre.
  const curry = inferRecipeTags({ title: 'Chicken Pot Pie', ingredients: ['chicken', 'peanut butter', 'coconut milk', 'rice flour'] });
  assert.deepEqual(curry.allergens, ['maní']);
  assert.deepEqual(curry.proteins, ['pollo']);
  assert.deepEqual(curry.mealTypes, []);
  assert.deepEqual(curry.diet, []);

  const salsa = inferRecipeTags({ title: 'Fresh Salsa', ingredients: ['tomato', 'onion', 'jalapeno peppers'] });
  assert.deepEqual(salsa.diet, ['vegetariana', 'vegana']);
  assert.deepEqual(salsa.mealTypes, ['salsa']);

  const spanish = inferRecipeTags({
    title: 'Pollo en salsa de tomate',
    ingredients: ['Pechuga de pollo', 'Tomate', 'Queso campesino', 'Harina de maíz'],
    productAllergens: ['en:milk'],
    mealType: 'almuerzo',
    nutrientsPerServing: { kcal: 380, protein_g: 32, carbs_g: 12 }
  });
  assert.deepEqual(spanish.allergens, ['leche']);
  assert.deepEqual(spanish.mealTypes, ['almuerzo']);
  assert.deepEqual(spanish.nutrition, ['alto en proteína', 'bajo en carbohidratos', 'bajo en calorías']);
});
