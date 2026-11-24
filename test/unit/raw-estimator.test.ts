import { describe, expect, it } from 'vitest';
import { estimateRaw, parseLine } from '../../src/modules/recipes/raw-estimator.js';
import { RAW_FOODS, rawIngredientRow } from '../../src/modules/recipes/raw-foods.js';

const p = (l: string) => {
  const r = parseLine(l);
  return r && [r.label, r.value, r.unit, Math.round(r.grams)];
};
const doc = (title: string, ingredients: string[], directions = ['Mix.', 'Bake 30 minutes.']) => ({ _id: 1, title, ingredients, directions });
const DINNER = ['2 lb. stew meat', '4 potatoes', '4 carrots', '1 onion', '4 c. water', 'salt and pepper'];

describe('macros de recetas en inglés, sin modelo', () => {
  it('lee cantidades y unidades', () => {
    expect(p('1 1/2 c. flour')).toEqual(['Flour', 1.5, 'cup', 188]);
    expect(p('3 T. flour')).toEqual(['Flour', 3, 'tbsp', 23]);
    expect(p('3 t. sugar')?.slice(1, 3)).toEqual([3, 'tsp']);
    expect(p('1 (8 oz.) pkg. cream cheese, cubed')).toEqual(['Cream cheese', 227, 'g', 227]);
    expect(p('2 cans (16 oz.) corn')).toEqual(['Corn', 907, 'g', 907]);
    expect(p('1 lb. ground beef')).toEqual(['Ground beef', 454, 'g', 454]);
    expect(p('2 large eggs, beaten')).toEqual(['Eggs', 2, 'unit', 100]);
    expect(p('1 stick butter')).toEqual(['Butter', 0.5, 'cup', 114]);
    expect(p('salt to taste')).toEqual(['Salt', null, 'toTaste', 0]);
    expect(p('2 c. cooked rice')?.[0]).toBe('Cooked rice');
    expect(p('1 c. grapes')?.[0]).toBe('Grapes');
    expect(p('1 red pepper, chopped')?.[3]).toBe(119);
  });

  it('lo que no entiende lo rechaza: no adivina', () => {
    for (const l of ['1 can cream of mushroom soup', '1 pkg. devils food cake mix', '1 jar of something', '3 c. 7-Up', '1 c. almond milk', 'flour', '1 c.']) expect(p(l), l).toBeNull();
    expect(estimateRaw(doc('Stew', [...DINNER, '1 can cream of celery soup']))).toBeNull();
    expect(estimateRaw(doc('Stew', DINNER, []))).toBeNull();
    expect(estimateRaw({ _id: 1, title: 'x' })).toBeNull();
  });

  it('alérgenos: nunca se pierde uno que aparezca en la línea, el título o los pasos', () => {
    expect(parseLine('1 c. rice krispies')!.food.allergens).toEqual(['gluten']);
    expect(parseLine('1 can beer')!.food.allergens).toEqual(['gluten']);
    expect(parseLine('2 Tbsp. butter or margarine')!.food.allergens).toEqual(['lactose']);
    expect(p('1 c. oil or butter')).toBeNull();
    expect(p('1 c. peanut oil')).toBeNull();
    expect(p('1 c. beans with ham')).toBeNull();
    expect(estimateRaw(doc('Stew', DINNER))).not.toBeNull();
    expect(estimateRaw(doc('Stew', DINNER, ['Sprinkle with chopped pecans.']))).toBeNull();
    expect(estimateRaw(doc('Stew', DINNER, ['Grease the pan with butter.']))).toBeNull();
    expect(estimateRaw(doc('Cheese stew', DINNER))).toBeNull();
    expect(parseLine('1 can pork and beans')!.food.diet).toContain('meat');
    expect(parseLine('1 Tbsp. Worcestershire sauce')!.food.diet).toContain('fish');
  });

  it('porciones según el plato y macros creíbles', () => {
    const stew = estimateRaw(doc('Beef Stew', DINNER, ['Brown meat.', 'Simmer 2 hours.']))!;
    expect(stew).toMatchObject({ mealSlots: ['lunch', 'dinner'], minutes: 130, difficulty: 'easy' });
    expect(stew.perServing.kcal).toBeGreaterThan(250);
    expect(stew.perServing.kcal).toBeLessThan(500);
    const cookies = estimateRaw(doc('Sugar Cookies', ['1 c. sugar', '1 c. butter', '2 eggs', '3 c. flour', '1 tsp. vanilla']))!;
    expect(cookies.mealSlots).toEqual(['snack1', 'snack2']);
    expect(cookies.perServing.kcal).toBeGreaterThan(200);
    expect(cookies.perServing.kcal).toBeLessThan(550);
    const m = cookies.perServing;
    expect(Math.abs(4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG - m.kcal) / m.kcal).toBeLessThan(0.15);
  });

  it('la tabla es coherente', () => {
    expect(new Set(RAW_FOODS.map((f) => f.key)).size).toBe(RAW_FOODS.length);
    for (const f of RAW_FOODS) {
      const [kcal, pr, c, fat] = f.per100;
      expect(f.per100.every((x) => Number.isFinite(x) && x >= 0), f.label).toBe(true);
      // El alcohol, la fibra del cacao y las especias no cuadran con 4/4/9.
      if (!f.trace && kcal > 60 && !['Wine', 'Cocoa'].includes(f.label)) expect(Math.abs(4 * pr + 4 * c + 9 * fat - kcal) / kcal, f.label).toBeLessThan(0.25);
      const row = rawIngredientRow(f, f.label);
      expect(row.id.length).toBeLessThanOrEqual(64);
      expect(row.categoryLabel, f.label).toBeTruthy();
    }
  });
});
