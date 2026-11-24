import { describe, expect, it } from 'vitest';
import type { FoodDoc } from '../../src/infrastructure/database/mongo/collections.js';
import { ingredientFromFood, parsePack } from '../../src/modules/catalog/food-ingredient.js';
import { rankFoods, sameWord, type FoodCandidate } from '../../src/modules/catalog/food-ranking.js';
import { searchTerms, stem } from '../../src/modules/catalog/food-text.js';

const food = (name: string, o: Partial<FoodDoc> = {}) => ingredientFromFood({ _id: 'x1', name, search: '', ...o });
const cand = (name: string, o: Partial<FoodCandidate> = {}): FoodCandidate => ({ name, brand: 'generic', foodGroups: [], nova: null, popularity: 0, completeness: 0.5, ...o });

describe('catálogo de alimentos de Mongo', () => {
  it('términos: sin tildes, conectores ni caracteres de regex', () => {
    expect(searchTerms('Aceite de OLIVA')).toEqual(['aceite', 'oliva']);
    expect(searchTerms('a.*(b+)$')).toEqual(['b']);
    expect(searchTerms('¿?')).toEqual([]);
    expect(stem('tomates')).toBe('tomat');
    expect(stem('res')).toBe('res');
    expect(sameWord('frijoles', 'frijol')).toBe(true);
    expect(sameWord('salchicha', 'sal')).toBe(false);
  });

  it('ranking: el alimento antes que los sabores y procesados, aunque sean más populares', () => {
    const r = rankFoods(['pollo'], [
      cand('Salchichas viena de pollo', { brand: 'Blony', popularity: 70, foodGroups: ['processed-meat'] }),
      cand('Margarita Pollo', { brand: 'Frito Lay', popularity: 40 }),
      cand('Ramen sabor a Pollo', { nova: 4 }),
      cand('Pechuga De Pollo', { brand: 'Taeq' }),
    ]);
    expect(r[0]!.name).toBe('Pechuga De Pollo');
    expect(r.filter((x) => x.reliable)).toHaveLength(1);
  });

  it('convierte el alimento en ingrediente: etiqueta, unidades, nutrición y lugar', () => {
    expect(
      food('Arroz', { _id: '7701', brand: 'Diana', quantity: '1 kg', servings: [{ label: '1/2 taza', grams: 92 }], foodGroups: ['en:cereals'], per100g: { kcal: 360, protein_g: 7, carbs_g: 79, fat_g: 0.6 } }),
    ).toMatchObject({
      id: 'food_7701',
      label: 'Arroz · Diana',
      categoryId: 'staples',
      categoryLabel: 'Despensa',
      defaultUnit: 'g',
      allowedUnits: ['g', 'kg', 'cup', 'unit'],
      gramsPerUnit: { cup: 184, unit: 1000 },
      typicalPack: { value: 1000, unit: 'g' },
      nutritionPer100g: { kcal: 360, proteinG: 7, carbsG: 79, fatG: 0.6, fiberG: 0 },
    });
    expect(food('Leche Entera Alquería', { brand: 'Alqueria', quantity: '1,1 L' })).toMatchObject({ label: 'Leche Entera Alquería', categoryId: 'dairy', defaultStorage: 'fridge', defaultUnit: 'ml', typicalPack: { value: 1100 } });
    expect(food('Banano', { servings: [{ label: '1 unidad mediana', grams: 118 }], foodGroups: ['fruits'] })).toMatchObject({ defaultUnit: 'unit', categoryId: 'produce', gramsPerUnit: { unit: 118 } });
    expect(food('Atún en aceite', { quantity: '160 g', state: 'canned' })).toMatchObject({ categoryId: 'seafood', defaultStorage: 'pantry' });
    expect(food('Papas sabor a pollo', { foodGroups: ['salty-snacks'] }).categoryId).toBe('staples');
    expect(food('Pechuga de pollo').defaultStorage).toBe('fridge');
    expect(food('Algo raro').nutritionPer100g).toBeNull();
  });

  it('empaques', () => {
    expect(parsePack('6 x 200 ml')).toEqual({ value: 1200, unit: 'ml' });
    expect(parsePack('1.100 g')).toEqual({ value: 1100, unit: 'g' });
    expect(parsePack('1.5 kg')).toEqual({ value: 1500, unit: 'g' });
    expect(parsePack('30 unidades')).toEqual({ value: 30, unit: 'unit' });
    expect(parsePack('familiar')).toBeNull();
  });

  it('alérgenos: lo declarado más lo que dice el texto', () => {
    expect(food('Galletas', { allergens: ['en:milk', 'en:eggs'] }).allergens.sort()).toEqual(['egg', 'gluten', 'lactose']);
    expect(food('Salsa', { ingredients: 'Tomate, crema de leche. Puede contener trazas de nueces' }).allergens).toEqual(['lactose']);
    expect(food('Barra', { ingredients: 'Avena. Puede contener trazas de leche, contiene maní' }).allergens).toEqual(['nuts']);
    expect(food('Leche deslactosada')).toMatchObject({ allergens: [], dietFlags: ['dairy', 'animal'] });
    expect(food('Leche de coco').dietFlags).toEqual([]);
    expect(food('Crema de maní').allergens).toEqual(['nuts']);
    expect(food('Nuez moscada').allergens).toEqual([]);
    expect(food('Harina de maíz').allergens).toEqual([]);
    expect(food('Langostinos').allergens).toEqual(['shellfish']);
  });

  it('dieta', () => {
    expect(food('Chorizo de cerdo').dietFlags).toEqual(['meat', 'animal']);
    expect(food('Lomos de atún').dietFlags).toEqual(['fish', 'animal']);
    expect(food('Queso vegano', { labels: ['en:vegan'] })).toMatchObject({ dietFlags: [], allergens: [] });
    expect(food('Hamburguesa vegetal').dietFlags).toEqual([]);
    expect(food('Miel de abejas').dietFlags).toEqual(['animal']);
  });

  it('producto real de products_slim (etiquetas sin prefijo, «non-vegan», porciones en g/oz)', () => {
    const real = food('Tosh Estilo Artesanal Galletas de Arroz, Chía, Quinua, Chocolate y Almendras', {
      _id: '7702025142460',
      brand: 'Nutresa',
      quantity: '26 g',
      nova: 4,
      foodGroups: ['biscuits-and-cakes', 'sugary-snacks'],
      per100g: { kcal: 461.5, protein_g: 3.85, carbs_g: 65.38, fat_g: 21.15, fiber_g: 0 },
      servings: [{ label: '26g', grams: 26 }, { label: '100 g', grams: 100 }, { label: '1 oz', grams: 28.35 }],
      allergens: ['eggs', 'nuts', 'soybeans'],
      dietTags: ['non-vegan', 'palm-oil', 'vegetarian-status-unknown'],
      labels: [],
      ingredients: 'Harina de Arroz (30.1%), Grasa Vegetal de Palma, Azúcar, Chocolate (Masa de Cacao, Manteca de Cacao), Quinua, Almendra (2.7%), Huevo, Sabor Natural de Almendra.',
    });
    expect(real).toMatchObject({ id: 'food_7702025142460', categoryId: 'staples', defaultUnit: 'g', allowedUnits: ['g', 'kg', 'unit'], gramsPerUnit: { unit: 26 }, unitLabel: ['paquete', 'paquetes'] });
    expect(real.nutritionPer100g).toMatchObject({ kcal: 461.5, proteinG: 3.85 });
    expect(real.dietFlags).toEqual(['egg', 'animal']);
    // «Galletas» cuenta como gluten aunque sean de arroz: con datos incompletos se prefiere avisar de más.
    expect(real.allergens.sort()).toEqual(['egg', 'gluten', 'nuts']);
    const ranked = rankFoods(['arroz'], [cand(real.label, { brand: 'Nutresa', nova: 4, popularity: 17, foodGroups: ['sugary-snacks'] }), cand('Arroz Excelso', { popularity: 1 })]);
    expect(ranked[0]!.name).toBe('Arroz Excelso');
  });
});
