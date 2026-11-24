import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISH_PHOTOS, dishPhoto, isDishFile } from '../../src/modules/recipes/dish-photos.js';

const dish = (title: string, ingredientLabels: string[] = [], dietFlags?: string[]) => dishPhoto({ id: 'x', title, ingredientLabels, dietFlags })?.replace(/-\d\.webp$/, '') ?? null;

describe('fotos de referencia', () => {
  it('cada foto declarada existe y no sobra ninguna', () => {
    const declared = Object.entries(DISH_PHOTOS).flatMap(([d, n]) => Array.from({ length: n }, (_, i) => `${d}-${i + 1}.webp`));
    expect(declared.filter((f) => !existsSync(new URL(`../../src/assets/dishes/${f}`, import.meta.url)))).toEqual([]);
    expect(readdirSync(new URL('../../src/assets/dishes', import.meta.url)).filter((f) => f.endsWith('.webp')).sort()).toEqual(declared.sort());
    expect(declared.every(isDishFile)).toBe(true);
  });

  it('reconoce el plato por el título, en inglés y español', () => {
    const cases: Record<string, string> = {
      'Chocolate Chip Cookies': 'cookies', 'Chicken Noodle Soup': 'soup', 'Mexican Cornbread': 'cornbread', 'Crab Cakes': 'shrimp', 'Aunt Mary\'s Green Bean Casserole': 'casserole',
      'Easy Chicken Pot Pie': 'quiche', 'Tuna Casserole': 'casserole', 'Pollo en salsa': 'chicken', 'Arroz con queso': 'rice', 'Banana Bread': 'quick-bread', 'Buffalo Wings': 'wings', 'Potato Salad': 'potato-salad', 'Meat Loaf': 'meatloaf', 'Macaroni and Cheese': 'creamy-pasta',
      'Pollo al curry': 'curry', 'Arepas con queso': 'arepa', 'Lentejas guisadas': 'chili', 'Sopa de verduras': 'soup', 'Tortilla de papa': 'omelette', 'Salmón a la plancha': 'fish', 'Arroz con pollo': 'rice', 'Cazuela de frijoles': 'chili',
    };
    const meat = ['meat', 'fish', 'shellfish'];
    expect(Object.fromEntries(Object.keys(cases).map((t) => [t, dish(t, [], meat)]))).toEqual(cases);
  });

  it('si el título no dice nada usa los ingredientes; si tampoco, ninguna; sin carne no muestra carne', () => {
    expect(dish('Mom\'s Favorite', ['Shrimp', 'Rice'], ['shellfish'])).toBe('shrimp');
    expect(dish('Mystery', ['Water'])).toBeNull();
    expect(dish('Vegan Burger', ['Black beans'], [])).not.toBe('burger');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) expect(dishPhoto({ id, title: 'Veggie Pizza', dietFlags: ['dairy'] })).toBe('pizza-1.webp');
    expect(dishPhoto({ id: 'z', title: 'Cookies' })).toBe(dishPhoto({ id: 'z', title: 'Cookies' }));
  });
});
