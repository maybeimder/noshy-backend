import type { Unit } from '../../../core/domain/quantity.js';
import type { MacrosWithFiber } from '../../../core/domain/nutrition.js';
import type { StepTemplate, UserStep } from '../postgres/types.js';

/** Datos de catálogo para desarrollo y pruebas. Los precios son referencias en COP. */

const CDN = 'https://cdn.noshy.app';

export const STORES = [
  { id: 'exito', name: 'Éxito', factor: 1.0 },
  { id: 'carulla', name: 'Carulla', factor: 1.12 },
  { id: 'd1', name: 'D1', factor: 0.88 },
  { id: 'jumbo', name: 'Jumbo', factor: 0.97 },
  { id: 'ara', name: 'Ara', factor: 0.9 },
  { id: 'plaza', name: 'Plaza', factor: 0.82, onlyCategories: ['produce'] },
].map((s, i) => ({ ...s, logoUrl: `${CDN}/stores/${s.id}.svg`, sort: i }));

export const DISHES = [
  { id: 'bibimbap', label: 'Bibimbap', cuisineId: 'korean', flavorTags: ['spicy', 'umami'] },
  { id: 'arepa', label: 'Arepa', cuisineId: 'colombian', flavorTags: ['avocado', 'cheese'] },
  { id: 'pasta', label: 'Pasta', cuisineId: 'italian', flavorTags: ['creamy', 'cheese'] },
  { id: 'tacos', label: 'Tacos', cuisineId: 'mexican', flavorTags: ['spicy', 'avocado'] },
  { id: 'poke', label: 'Poke', cuisineId: 'hawaiian', flavorTags: ['fresh', 'avocado'] },
  { id: 'soups', label: 'Sopas', cuisineId: 'colombian', flavorTags: ['comfort'] },
  { id: 'pancakes', label: 'Pancakes', cuisineId: 'american', flavorTags: ['sweet', 'plantain'] },
  { id: 'salads', label: 'Ensaladas', cuisineId: 'international', flavorTags: ['fresh'] },
  { id: 'curry', label: 'Curry', cuisineId: 'indian', flavorTags: ['spicy', 'creamy'] },
].map((d, i) => ({ ...d, imageUrl: `${CDN}/dishes/${d.id}.webp`, sort: i }));

export { CATEGORY_LABELS, CUISINES } from '../../../core/domain/catalog.js';
import { CATEGORY_LABELS, CUISINES } from '../../../core/domain/catalog.js';

type IngSeed = {
  id: string;
  label: string;
  icon: string;
  cat: keyof typeof CATEGORY_LABELS;
  storage: 'fridge' | 'pantry' | 'freezer';
  life: number;
  allergens?: string[];
  diet?: string[];
  flavor?: string[];
  n: [kcal: number, p: number, c: number, f: number, fiber: number] | null;
  unit: Unit;
  units: Unit[];
  gpu?: Partial<Record<Unit, number>>;
  unitLabel?: [string, string];
  pack: { value: number; unit: Unit; label: string; price: number };
  basic?: boolean;
};

const I = (x: IngSeed) => x;
export const INGREDIENTS: IngSeed[] = [
  I({ id: 'ing_spinach', label: 'Espinaca baby', icon: 'leaf', cat: 'produce', storage: 'fridge', life: 5, n: [23, 2.9, 3.6, 0.4, 2.2], unit: 'g', units: ['g', 'kg'], pack: { value: 250, unit: 'g', label: '250 g', price: 7100 } }),
  I({ id: 'ing_tomato', label: 'Tomate', icon: 'tomato', cat: 'produce', storage: 'pantry', life: 7, n: [18, 0.9, 3.9, 0.2, 1.2], unit: 'unit', units: ['unit', 'g', 'kg'], gpu: { unit: 120 }, pack: { value: 1, unit: 'kg', label: '1 kg', price: 4200 } }),
  I({ id: 'ing_garlic', label: 'Ajo', icon: 'sprout', cat: 'produce', storage: 'pantry', life: 30, n: [149, 6.4, 33, 0.5, 2.1], unit: 'clove', units: ['clove', 'g', 'unit'], gpu: { clove: 5, unit: 40 }, unitLabel: ['cabeza', 'cabezas'], pack: { value: 2, unit: 'unit', label: '2 cabezas', price: 1200 }, basic: true }),
  I({ id: 'ing_onion', label: 'Cebolla cabezona', icon: 'onion', cat: 'produce', storage: 'pantry', life: 21, n: [40, 1.1, 9.3, 0.1, 1.7], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 150 }, pack: { value: 1, unit: 'kg', label: '1 kg', price: 3600 } }),
  I({ id: 'ing_avocado', label: 'Aguacate', icon: 'avocado', cat: 'produce', storage: 'pantry', life: 4, flavor: ['avocado'], n: [160, 2, 8.5, 14.7, 6.7], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 200 }, pack: { value: 1, unit: 'unit', label: '1 unidad', price: 4500 } }),
  I({ id: 'ing_basil', label: 'Albahaca', icon: 'herb', cat: 'produce', storage: 'fridge', life: 5, n: [23, 3.2, 2.7, 0.6, 1.6], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 20 }, unitLabel: ['atado', 'atados'], pack: { value: 1, unit: 'unit', label: '1 atado', price: 2500 } }),
  I({ id: 'ing_cilantro', label: 'Cilantro', icon: 'herb', cat: 'produce', storage: 'fridge', life: 5, n: [23, 2.1, 3.7, 0.5, 2.8], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 20 }, unitLabel: ['atado', 'atados'], pack: { value: 1, unit: 'unit', label: '1 atado', price: 1500 } }),
  I({ id: 'ing_lemon', label: 'Limón Tahití', icon: 'citrus', cat: 'produce', storage: 'fridge', life: 14, n: [29, 1.1, 9.3, 0.3, 2.8], unit: 'unit', units: ['unit'], gpu: { unit: 60 }, pack: { value: 5, unit: 'unit', label: '5 und', price: 2500 } }),
  I({ id: 'ing_carrot', label: 'Zanahoria', icon: 'carrot', cat: 'produce', storage: 'fridge', life: 21, n: [41, 0.9, 9.6, 0.2, 2.8], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 80 }, pack: { value: 1, unit: 'kg', label: '1 kg', price: 2900 } }),
  I({ id: 'ing_cucumber', label: 'Pepino', icon: 'cucumber', cat: 'produce', storage: 'fridge', life: 7, n: [15, 0.7, 3.6, 0.1, 0.5], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 200 }, pack: { value: 1, unit: 'unit', label: '1 unidad', price: 1400 } }),
  I({ id: 'ing_potato_criolla', label: 'Papa criolla', icon: 'potato', cat: 'produce', storage: 'pantry', life: 14, n: [97, 2.3, 21, 0.1, 1.6], unit: 'g', units: ['g', 'kg'], pack: { value: 1, unit: 'kg', label: '1 kg', price: 4800 } }),
  I({ id: 'ing_plantain', label: 'Plátano maduro', icon: 'banana', cat: 'produce', storage: 'pantry', life: 6, flavor: ['plantain', 'sweet'], n: [122, 1.3, 32, 0.4, 2.3], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 250 }, pack: { value: 1, unit: 'unit', label: '1 unidad', price: 1300 } }),
  I({ id: 'ing_banana', label: 'Banano', icon: 'banana', cat: 'produce', storage: 'pantry', life: 6, flavor: ['sweet'], n: [89, 1.1, 23, 0.3, 2.6], unit: 'unit', units: ['unit', 'g'], gpu: { unit: 120 }, pack: { value: 6, unit: 'unit', label: '6 und', price: 3000 } }),
  I({ id: 'ing_pineapple', label: 'Piña', icon: 'pineapple', cat: 'produce', storage: 'pantry', life: 5, flavor: ['sweet'], n: [50, 0.5, 13, 0.1, 1.4], unit: 'g', units: ['g', 'unit'], gpu: { unit: 1200 }, pack: { value: 1, unit: 'unit', label: '1 unidad', price: 5500 } }),
  I({ id: 'ing_asparagus', label: 'Espárragos', icon: 'sprout', cat: 'produce', storage: 'fridge', life: 4, n: [20, 2.2, 3.9, 0.1, 2.1], unit: 'g', units: ['g'], pack: { value: 250, unit: 'g', label: '250 g', price: 9800 } }),

  I({ id: 'ing_chickenbreast', label: 'Pechuga de pollo', icon: 'drumstick', cat: 'protein', storage: 'fridge', life: 3, diet: ['meat', 'animal'], n: [120, 22.5, 0, 2.6, 0], unit: 'g', units: ['g', 'kg'], pack: { value: 500, unit: 'g', label: '500 g', price: 14200 } }),
  I({ id: 'ing_groundbeef', label: 'Carne molida', icon: 'meat', cat: 'protein', storage: 'fridge', life: 2, diet: ['meat', 'animal'], n: [250, 26, 0, 15, 0], unit: 'g', units: ['g', 'kg'], pack: { value: 500, unit: 'g', label: '500 g', price: 15900 } }),
  I({ id: 'ing_beefsteak', label: 'Lomo de res', icon: 'meat', cat: 'protein', storage: 'fridge', life: 3, diet: ['meat', 'animal'], n: [190, 28, 0, 8.5, 0], unit: 'g', units: ['g', 'kg'], pack: { value: 500, unit: 'g', label: '500 g', price: 28900 } }),
  I({ id: 'ing_pork', label: 'Lomo de cerdo', icon: 'meat', cat: 'protein', storage: 'fridge', life: 3, diet: ['meat', 'animal'], n: [143, 21, 0, 6.3, 0], unit: 'g', units: ['g', 'kg'], pack: { value: 500, unit: 'g', label: '500 g', price: 16500 } }),
  I({ id: 'ing_egg', label: 'Huevos AA', icon: 'egg', cat: 'protein', storage: 'fridge', life: 21, allergens: ['egg'], diet: ['egg', 'animal'], n: [143, 12.6, 0.7, 9.5, 0], unit: 'unit', units: ['unit'], gpu: { unit: 50 }, unitLabel: ['huevo', 'huevos'], pack: { value: 12, unit: 'unit', label: '12 und', price: 4500 } }),
  I({ id: 'ing_tofu', label: 'Tofu firme', icon: 'tofu', cat: 'protein', storage: 'fridge', life: 10, allergens: [], n: [144, 15.8, 2.8, 8.7, 2.3], unit: 'g', units: ['g'], pack: { value: 400, unit: 'g', label: '400 g', price: 9900 } }),
  I({ id: 'ing_shrimp', label: 'Camarón', icon: 'shrimp', cat: 'seafood', storage: 'freezer', life: 90, allergens: ['shellfish'], diet: ['shellfish', 'animal'], n: [99, 24, 0.2, 0.3, 0], unit: 'g', units: ['g', 'kg'], pack: { value: 400, unit: 'g', label: '400 g', price: 24900 } }),
  I({ id: 'ing_salmon', label: 'Salmón', icon: 'fish', cat: 'seafood', storage: 'fridge', life: 2, diet: ['fish', 'animal'], n: [208, 20, 0, 13, 0], unit: 'g', units: ['g'], pack: { value: 300, unit: 'g', label: '300 g', price: 27900 } }),
  I({ id: 'ing_cod', label: 'Bacalao', icon: 'fish', cat: 'seafood', storage: 'freezer', life: 90, diet: ['fish', 'animal'], n: [82, 18, 0, 0.7, 0], unit: 'g', units: ['g'], pack: { value: 400, unit: 'g', label: '400 g', price: 21900 } }),

  I({ id: 'ing_cream', label: 'Crema de leche', icon: 'bottle', cat: 'dairy', storage: 'fridge', life: 10, allergens: ['lactose'], diet: ['dairy', 'animal'], flavor: ['creamy'], n: [340, 2.1, 2.8, 36, 0], unit: 'ml', units: ['ml', 'tbsp', 'cup'], pack: { value: 200, unit: 'ml', label: '200 ml', price: 4600 } }),
  I({ id: 'ing_milk', label: 'Leche entera', icon: 'bottle', cat: 'dairy', storage: 'fridge', life: 7, allergens: ['lactose'], diet: ['dairy', 'animal'], n: [61, 3.2, 4.8, 3.3, 0], unit: 'ml', units: ['ml', 'l', 'cup'], pack: { value: 1, unit: 'l', label: '1 l', price: 4300 } }),
  I({ id: 'ing_pecorino', label: 'Pecorino Romano', icon: 'cheese', cat: 'dairy', storage: 'fridge', life: 45, allergens: ['lactose'], diet: ['dairy', 'animal'], flavor: ['cheese'], n: [387, 32, 3.6, 27, 0], unit: 'g', units: ['g'], pack: { value: 150, unit: 'g', label: '150 g', price: 18900 } }),
  I({ id: 'ing_freshcheese', label: 'Queso campesino', icon: 'cheese', cat: 'dairy', storage: 'fridge', life: 10, allergens: ['lactose'], diet: ['dairy', 'animal'], flavor: ['cheese'], n: [264, 18, 3, 20, 0], unit: 'g', units: ['g'], pack: { value: 250, unit: 'g', label: '250 g', price: 7900 } }),
  I({ id: 'ing_yogurt', label: 'Yogur griego', icon: 'cup', cat: 'dairy', storage: 'fridge', life: 14, allergens: ['lactose'], diet: ['dairy', 'animal'], flavor: ['creamy'], n: [97, 9, 3.6, 5, 0], unit: 'g', units: ['g', 'cup'], gpu: { cup: 245 }, pack: { value: 500, unit: 'g', label: '500 g', price: 9900 } }),
  I({ id: 'ing_butter', label: 'Mantequilla', icon: 'butter', cat: 'dairy', storage: 'fridge', life: 60, allergens: ['lactose'], diet: ['dairy', 'animal'], n: [717, 0.9, 0.1, 81, 0], unit: 'tbsp', units: ['tbsp', 'g'], gpu: { tbsp: 14 }, pack: { value: 250, unit: 'g', label: '250 g', price: 8900 } }),
  I({ id: 'ing_vegancheese', label: 'Queso vegetal', icon: 'cheese', cat: 'dairy', storage: 'fridge', life: 30, flavor: ['cheese'], n: [280, 2, 20, 22, 0], unit: 'g', units: ['g'], pack: { value: 200, unit: 'g', label: '200 g', price: 14900 } }),
  I({ id: 'ing_oatdrink', label: 'Bebida de avena', icon: 'glass', cat: 'drinks', storage: 'fridge', life: 7, flavor: ['creamy'], n: [45, 1, 6.5, 1.5, 0.8], unit: 'ml', units: ['ml', 'l', 'cup'], pack: { value: 1000, unit: 'ml', label: '1000 ml', price: 8900 } }),
  I({ id: 'ing_coconutcream', label: 'Crema de coco', icon: 'bottle', cat: 'staples', storage: 'pantry', life: 365, flavor: ['creamy'], n: [330, 3.6, 6.7, 33, 2.2], unit: 'ml', units: ['ml', 'tbsp'], pack: { value: 400, unit: 'ml', label: '400 ml', price: 8500 } }),

  I({ id: 'ing_rigatoni', label: 'Rigatoni', icon: 'pasta', cat: 'staples', storage: 'pantry', life: 540, allergens: ['gluten'], n: [371, 13, 75, 1.5, 3], unit: 'g', units: ['g'], pack: { value: 500, unit: 'g', label: '500 g', price: 7800 } }),
  I({ id: 'ing_spaghetti', label: 'Espagueti', icon: 'pasta', cat: 'staples', storage: 'pantry', life: 540, allergens: ['gluten'], n: [371, 13, 75, 1.5, 3], unit: 'g', units: ['g'], pack: { value: 500, unit: 'g', label: '500 g', price: 4900 } }),
  I({ id: 'ing_chickpeapasta', label: 'Pasta de garbanzo', icon: 'pasta', cat: 'staples', storage: 'pantry', life: 365, n: [350, 21, 52, 6, 8], unit: 'g', units: ['g'], pack: { value: 250, unit: 'g', label: '250 g', price: 11900 } }),
  I({ id: 'ing_rice', label: 'Arroz', icon: 'rice', cat: 'staples', storage: 'pantry', life: 365, n: [360, 7, 79, 0.6, 1.3], unit: 'g', units: ['g', 'cup', 'kg'], gpu: { cup: 185 }, pack: { value: 1000, unit: 'g', label: '1 kg', price: 4900 } }),
  I({ id: 'ing_arepaflour', label: 'Harina de maíz precocida', icon: 'flour', cat: 'staples', storage: 'pantry', life: 365, n: [350, 7, 77, 1.5, 7], unit: 'g', units: ['g', 'cup'], gpu: { cup: 140 }, pack: { value: 1000, unit: 'g', label: '1 kg', price: 5600 } }),
  I({ id: 'ing_oats', label: 'Avena en hojuelas', icon: 'glass', cat: 'staples', storage: 'pantry', life: 270, n: [389, 17, 66, 7, 10], unit: 'g', units: ['g', 'cup'], gpu: { cup: 90 }, pack: { value: 500, unit: 'g', label: '500 g', price: 5200 } }),
  I({ id: 'ing_lentils', label: 'Lentejas', icon: 'legume', cat: 'staples', storage: 'pantry', life: 365, n: [353, 25, 60, 1, 11], unit: 'g', units: ['g', 'cup', 'kg'], gpu: { cup: 190 }, pack: { value: 500, unit: 'g', label: '500 g', price: 3900 } }),
  I({ id: 'ing_tortilla', label: 'Tortillas de maíz', icon: 'bread', cat: 'bakery', storage: 'fridge', life: 15, n: [218, 5.7, 44, 2.9, 6], unit: 'unit', units: ['unit'], gpu: { unit: 25 }, pack: { value: 12, unit: 'unit', label: '12 und', price: 6900 } }),
  I({ id: 'ing_nori', label: 'Alga nori', icon: 'leaf', cat: 'staples', storage: 'pantry', life: 365, n: [35, 5.8, 5.1, 0.3, 0.3], unit: 'unit', units: ['unit'], gpu: { unit: 3 }, unitLabel: ['hoja', 'hojas'], pack: { value: 10, unit: 'unit', label: '10 hojas', price: 12900 } }),
  I({ id: 'ing_granola', label: 'Granola', icon: 'cereal', cat: 'staples', storage: 'pantry', life: 180, allergens: ['nuts', 'gluten'], n: [471, 10, 64, 20, 7], unit: 'g', units: ['g', 'cup'], gpu: { cup: 120 }, pack: { value: 400, unit: 'g', label: '400 g', price: 13900 } }),
  I({ id: 'ing_flour', label: 'Harina de trigo', icon: 'flour', cat: 'staples', storage: 'pantry', life: 240, allergens: ['gluten'], n: [364, 10, 76, 1, 2.7], unit: 'g', units: ['g', 'cup'], gpu: { cup: 125 }, pack: { value: 1000, unit: 'g', label: '1 kg', price: 3900 } }),
  I({ id: 'ing_oatcookies', label: 'Galletas de avena', icon: 'cookie', cat: 'bakery', storage: 'pantry', life: 120, allergens: ['gluten'], n: [450, 6, 66, 18, 4], unit: 'unit', units: ['unit'], gpu: { unit: 30 }, unitLabel: ['paquete', 'paquetes'], pack: { value: 1, unit: 'unit', label: '1 paquete', price: 6900 } }),
  I({ id: 'ing_honey', label: 'Miel', icon: 'honey', cat: 'staples', storage: 'pantry', life: 720, flavor: ['sweet'], n: [304, 0.3, 82, 0, 0.2], unit: 'tbsp', units: ['tbsp', 'tsp'], gpu: { tbsp: 21, tsp: 7 }, pack: { value: 300, unit: 'g', label: '300 g', price: 11900 } }),
  I({ id: 'ing_oliveoil', label: 'Aceite de oliva', icon: 'drop', cat: 'staples', storage: 'pantry', life: 540, n: [884, 0, 0, 100, 0], unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], gpu: { tbsp: 13.5, tsp: 4.5 }, pack: { value: 500, unit: 'ml', label: '500 ml', price: 21000 }, basic: true }),
  I({ id: 'ing_sesameoil', label: 'Aceite de ajonjolí', icon: 'drop', cat: 'staples', storage: 'pantry', life: 365, n: [884, 0, 0, 100, 0], unit: 'tbsp', units: ['tbsp', 'tsp'], gpu: { tbsp: 13.5, tsp: 4.5 }, pack: { value: 250, unit: 'ml', label: '250 ml', price: 16900 }, basic: true }),
  I({ id: 'ing_tomatopaste', label: 'Pasta de tomate', icon: 'can', cat: 'staples', storage: 'pantry', life: 365, n: [82, 4.3, 19, 0.5, 4.1], unit: 'tbsp', units: ['tbsp', 'g'], gpu: { tbsp: 16 }, pack: { value: 200, unit: 'g', label: '200 g', price: 3200 } }),
  I({ id: 'ing_soysauce', label: 'Salsa de soya', icon: 'bottle', cat: 'staples', storage: 'pantry', life: 720, allergens: ['gluten'], flavor: ['umami'], n: [53, 8, 4.9, 0.6, 0.8], unit: 'tbsp', units: ['tbsp', 'tsp'], gpu: { tbsp: 16, tsp: 5 }, pack: { value: 150, unit: 'ml', label: '150 ml', price: 6900 } }),
  I({ id: 'ing_tamari', label: 'Tamari sin gluten', icon: 'bottle', cat: 'staples', storage: 'pantry', life: 720, flavor: ['umami'], n: [60, 10, 5.6, 0.1, 0.8], unit: 'tbsp', units: ['tbsp', 'tsp'], gpu: { tbsp: 16, tsp: 5 }, pack: { value: 250, unit: 'ml', label: '250 ml', price: 18900 } }),
  I({ id: 'ing_gochujang', label: 'Gochujang', icon: 'jar', cat: 'staples', storage: 'fridge', life: 365, allergens: ['gluten'], flavor: ['spicy'], n: [190, 4, 40, 1.5, 2], unit: 'tbsp', units: ['tbsp', 'tsp'], gpu: { tbsp: 18, tsp: 6 }, pack: { value: 200, unit: 'g', label: '200 g', price: 19900 } }),
  I({ id: 'ing_salt', label: 'Sal marina', icon: 'salt', cat: 'spices', storage: 'pantry', life: 3650, n: [0, 0, 0, 0, 0], unit: 'pinch', units: ['pinch', 'tsp', 'toTaste'], gpu: { tsp: 6 }, pack: { value: 500, unit: 'g', label: '500 g', price: 2900 }, basic: true }),
  I({ id: 'ing_pepper', label: 'Pimienta negra', icon: 'pepper', cat: 'spices', storage: 'pantry', life: 730, n: [251, 10, 64, 3.3, 25], unit: 'toTaste', units: ['toTaste', 'tsp', 'pinch'], gpu: { tsp: 2.3 }, pack: { value: 50, unit: 'g', label: '50 g', price: 4900 }, basic: true }),
  I({ id: 'ing_paprika', label: 'Paprika ahumada', icon: 'flame', cat: 'spices', storage: 'pantry', life: 730, flavor: ['smoky'], n: [282, 14, 54, 13, 35], unit: 'tsp', units: ['tsp', 'tbsp'], gpu: { tsp: 2.3, tbsp: 6.9 }, pack: { value: 40, unit: 'g', label: '40 g', price: 5900 }, basic: true }),
  I({ id: 'ing_oregano', label: 'Orégano seco', icon: 'sprout', cat: 'spices', storage: 'pantry', life: 730, n: [265, 9, 69, 4.3, 43], unit: 'tsp', units: ['tsp', 'tbsp'], gpu: { tsp: 1, tbsp: 3 }, pack: { value: 15, unit: 'g', label: '15 g', price: 2800 }, basic: true }),
];

export const BASIC_INGREDIENT_IDS = INGREDIENTS.filter((i) => i.basic).map((i) => i.id);

export const SUBSTITUTES: { from: string; to: string; reason: string; priority?: number }[] = [
  { from: 'ing_cream', to: 'ing_oatdrink', reason: 'lactose' },
  { from: 'ing_cream', to: 'ing_coconutcream', reason: 'lactose', priority: 2 },
  { from: 'ing_cream', to: 'ing_coconutcream', reason: 'vegan' },
  { from: 'ing_milk', to: 'ing_oatdrink', reason: 'lactose' },
  { from: 'ing_milk', to: 'ing_oatdrink', reason: 'vegan' },
  { from: 'ing_butter', to: 'ing_oliveoil', reason: 'lactose' },
  { from: 'ing_butter', to: 'ing_oliveoil', reason: 'vegan' },
  { from: 'ing_pecorino', to: 'ing_vegancheese', reason: 'lactose' },
  { from: 'ing_pecorino', to: 'ing_vegancheese', reason: 'vegan' },
  { from: 'ing_freshcheese', to: 'ing_vegancheese', reason: 'lactose' },
  { from: 'ing_freshcheese', to: 'ing_vegancheese', reason: 'vegan' },
  { from: 'ing_rigatoni', to: 'ing_chickpeapasta', reason: 'gluten' },
  { from: 'ing_rigatoni', to: 'ing_chickpeapasta', reason: 'moreProtein' },
  { from: 'ing_spaghetti', to: 'ing_chickpeapasta', reason: 'gluten' },
  { from: 'ing_spaghetti', to: 'ing_chickpeapasta', reason: 'moreProtein' },
  { from: 'ing_soysauce', to: 'ing_tamari', reason: 'gluten' },
  { from: 'ing_chickenbreast', to: 'ing_tofu', reason: 'vegetarian' },
  { from: 'ing_chickenbreast', to: 'ing_tofu', reason: 'vegan' },
  { from: 'ing_groundbeef', to: 'ing_lentils', reason: 'vegetarian' },
  { from: 'ing_groundbeef', to: 'ing_lentils', reason: 'vegan' },
  { from: 'ing_groundbeef', to: 'ing_lentils', reason: 'pescatarian' },
  { from: 'ing_shrimp', to: 'ing_chickenbreast', reason: 'shellfish' },
  { from: 'ing_shrimp', to: 'ing_tofu', reason: 'vegetarian' },
  { from: 'ing_shrimp', to: 'ing_tofu', reason: 'vegan' },
  { from: 'ing_pork', to: 'ing_chickenbreast', reason: 'custom' },
  { from: 'ing_pork', to: 'ing_tofu', reason: 'vegetarian' },
  { from: 'ing_cilantro', to: 'ing_basil', reason: 'custom' },
];

/** Productos con marca (además de uno genérico por ingrediente que genera el seed). */
export const BRANDED_PRODUCTS: { id: string; ingredientId: string; brand: string; label: string; value: number; unit: Unit; packLabel: string; base: number; tags?: string[]; stores?: string[] }[] = [
  { id: 'prd_macpollo500', ingredientId: 'ing_chickenbreast', brand: 'Mac Pollo', label: 'Mac Pollo 500 g', value: 500, unit: 'g', packLabel: '500 g', base: 14660 },
  { id: 'prd_alpina_avena1l', ingredientId: 'ing_oatdrink', brand: 'Alpina', label: 'Alpina Avena sin azúcar', value: 1000, unit: 'ml', packLabel: '1000 ml', base: 10110, tags: ['sinAzucar', 'sinLactosa'] },
  { id: 'prd_kikes12', ingredientId: 'ing_egg', brand: 'Kikes', label: 'Huevos AA Kikes x12', value: 12, unit: 'unit', packLabel: '12 und', base: 5100 },
  { id: 'prd_pomona_pecorino150', ingredientId: 'ing_pecorino', brand: 'Pomona', label: 'Pecorino Romano Pomona', value: 150, unit: 'g', packLabel: '150 g', base: 21400 },
  { id: 'prd_dececco_rig500', ingredientId: 'ing_rigatoni', brand: 'De Cecco', label: 'Rigatoni De Cecco', value: 500, unit: 'g', packLabel: '500 g', base: 8900 },
  { id: 'prd_alpina_crema200', ingredientId: 'ing_cream', brand: 'Alpina', label: 'Crema de leche Alpina', value: 200, unit: 'ml', packLabel: '200 ml', base: 5200 },
];

// ---------- Recetas ----------

type RI = [ingredientId: string, value: number | null, unit: Unit, prep?: string];
const ri = (id: string, value: number | null, unit: Unit, prep?: string): RI => [id, value, unit, prep];

export type RecipeSeed = {
  id: string;
  title: string;
  slug: string;
  cuisineId: string;
  dishId: string | null;
  tags: string[];
  flavorTags: string[];
  mealSlots: string[];
  time: [number, number];
  servings: number;
  difficulty: 'easy' | 'medium' | 'hard';
  ingredients: RI[];
  steps: StepTemplate[];
  author?: string;
  rating?: [sum: number, count: number];
  likes?: number;
  chefConsultable?: boolean;
  publishedDaysAgo?: number;
};

const S = (
  title: string,
  heatLevel: number,
  equipment: string | null,
  ingredients: StepTemplate['ingredients'],
  subSteps: [shortLabel: string, text: string, timerSeconds: number | null, heat?: number][],
  doneWhen: string | null = null,
): StepTemplate => ({
  title,
  heatLevel,
  equipment,
  ingredients,
  subSteps: subSteps.map(([shortLabel, text, timerSeconds, heat]) => ({ shortLabel, text, timerSeconds, heatLevel: heat ?? heatLevel })),
  durationSeconds: subSteps.reduce((a, s) => a + (s[2] ?? 0), 0),
  doneWhen,
});
const si = (ingredientId: string, value: number | null, unit: Unit, prep: string | null = null) => ({ ingredientId, value, unit, prep });
const from = (label: string, fromStepIndex: number) => ({ ingredientId: null, label, prep: null, value: null, unit: 'all' as Unit, fromStepIndex });

/** Pasos simples para recetas cortas: un subpaso por línea. */
const quick = (lines: [string, string, number | null, number][]): StepTemplate[] =>
  lines.map(([title, text, timer, heat]) => S(title, heat, null, [], [[title, text, timer, heat]]));

export const RECIPES: RecipeSeed[] = [
  {
    id: 'rcp_01JPASTAROSA',
    title: 'Pasta rosa con pollo',
    slug: 'pasta-rosa-con-pollo',
    cuisineId: 'italian',
    dishId: 'pasta',
    tags: ['Pasta', 'Pollo', 'Salsa rosa', 'Alta en proteína'],
    flavorTags: ['creamy'],
    mealSlots: ['lunch', 'dinner'],
    time: [20, 25],
    servings: 2,
    difficulty: 'easy',
    rating: [605, 126],
    likes: 310,
    ingredients: [
      ri('ing_rigatoni', 120, 'g'),
      ri('ing_chickenbreast', 300, 'g', 'en cubos de 2 cm'),
      ri('ing_tomato', 2, 'unit'),
      ri('ing_spinach', 150, 'g', 'lavada'),
      ri('ing_cream', 100, 'ml'),
      ri('ing_basil', 1, 'unit'),
      ri('ing_pecorino', 15, 'g'),
      ri('ing_tomatopaste', 3, 'tbsp'),
      ri('ing_garlic', 2, 'clove', 'en láminas finas'),
      ri('ing_oliveoil', 2, 'tbsp'),
      ri('ing_paprika', 1, 'tsp'),
      ri('ing_salt', 1, 'pinch'),
      ri('ing_pepper', null, 'toTaste'),
    ],
    steps: [
      S('Cocina la pasta al dente', 8, 'Olla grande', [si('ing_rigatoni', 120, 'g'), si('ing_salt', 1, 'pinch')], [
        ['Hervir el agua', 'Pon a hervir 2 litros de agua con la sal a fuego alto.', 240, 9],
        ['Cocinar la pasta', 'Agrega los rigatoni y cocina revolviendo de vez en cuando hasta que estén al dente.', 540, 7],
        ['Escurrir', 'Escurre la pasta y reserva media taza del agua de cocción.', 60, 0],
      ], 'la pasta se dobla pero todavía tiene un punto firme en el centro.'),
      S('Prepara la salsa rosa', 0, 'Licuadora', [si('ing_tomato', 2, 'unit', 'en cuartos'), si('ing_tomatopaste', 3, 'tbsp'), si('ing_cream', 100, 'ml')], [
        ['Licuar el tomate', 'Licúa el tomate con la pasta de tomate hasta que quede liso.', 60, 0],
        ['Mezclar con la crema', 'Pasa la mezcla a un tazón e incorpora la crema con un batidor.', 60, 0],
      ], 'la salsa tiene un color rosa parejo, sin vetas rojas.'),
      S('Saltea la espinaca con el ajo', 5, 'Sartén 28 cm', [si('ing_spinach', 150, 'g', 'lavada'), si('ing_garlic', 2, 'clove', 'en láminas finas'), si('ing_oliveoil', 2, 'tbsp'), si('ing_salt', 1, 'pinch')], [
        ['Calentar el aceite', 'Calienta el aceite en la sartén a fuego medio hasta que brille, sin llegar a humear.', 60, 5],
        ['Dorar el ajo', 'Añade el ajo y muévelo con espátula hasta que esté dorado pálido. No lo dejes tostar o amargará.', 45, 5],
        ['Saltear espinaca y ajo', 'Incorpora la espinaca en dos tandas con la pizca de sal; voltea con pinzas hasta que se marchite y reduzca a la mitad.', 180, 5],
        ['Reservar el jugo', 'Retira del fuego y reserva el jugo en la sartén: lo usarás en el paso 4.', 75, 0],
      ], 'las hojas se ven brillantes, verde intenso y el ajo huele a nuez.'),
      S('Sella el pollo a fuego alto', 8, 'Misma sartén', [si('ing_chickenbreast', 300, 'g', 'en cubos de 2 cm'), from('Jugo reservado del paso 3', 2), si('ing_paprika', 1, 'tsp'), si('ing_pepper', null, 'toTaste')], [
        ['Sazonar el pollo', 'Seca el pollo con papel absorbente y sazónalo con paprika, sal y pimienta.', 60, 0],
        ['Sellar el pollo', 'Sube a fuego alto y espera 1 min. Coloca los cubos separados, sin moverlos, hasta que se despeguen solos.', 120, 8],
        ['Dorar el otro lado', 'Voltea cada cubo y dora el otro lado; el centro debe quedar firme al presionar.', 150, 8],
        ['Integrar la espinaca', 'Baja a fuego medio, devuelve la espinaca con su jugo y mezcla 30 segundos.', 90, 5],
      ], 'el pollo tiene costra dorada y suelta la sartén sin esfuerzo.'),
      S('Une la salsa y la pasta', 3, 'Misma sartén', [from('Salsa rosa del paso 2', 1), from('Pasta del paso 1', 0)], [
        ['Calentar la salsa', 'Vierte la salsa rosa sobre el pollo y calienta a fuego bajo sin que hierva.', 180, 3],
        ['Agregar la pasta', 'Agrega la pasta y un chorrito del agua reservada; mezcla hasta que la salsa la cubra.', 120, 3],
      ], 'la salsa cubre cada rigatoni y brilla.'),
      S('Sirve y termina', 0, null, [si('ing_basil', 1, 'unit', 'en hojas'), si('ing_pecorino', 15, 'g', 'rallado')], [
        ['Servir', 'Sirve en platos hondos, ralla el pecorino por encima y termina con albahaca fresca.', 60, 0],
      ]),
    ],
  },
  {
    id: 'rcp_01STEAKSHRIMP', title: 'Steak y camarón', slug: 'steak-y-camaron', cuisineId: 'international', dishId: null,
    tags: ['Carne', 'Mariscos', 'Alta en proteína'], flavorTags: ['smoky'], mealSlots: ['lunch', 'dinner'], time: [25, 30], servings: 2, difficulty: 'medium', rating: [440, 96],
    ingredients: [ri('ing_beefsteak', 300, 'g'), ri('ing_shrimp', 200, 'g'), ri('ing_butter', 2, 'tbsp'), ri('ing_garlic', 3, 'clove'), ri('ing_lemon', 1, 'unit'), ri('ing_salt', 1, 'pinch'), ri('ing_pepper', null, 'toTaste')],
    steps: quick([
      ['Sella el lomo', 'Sazona el lomo y séllalo 3 minutos por lado en sartén muy caliente. Deja reposar.', 360, 9],
      ['Saltea los camarones', 'En la misma sartén derrite la mantequilla con el ajo y saltea los camarones hasta que estén rosados.', 180, 7],
      ['Sirve', 'Corta el lomo en tajadas, sirve con los camarones y termina con limón.', 60, 0],
    ]),
  },
  {
    id: 'rcp_01BIBIMBAP', title: 'Bibimbap', slug: 'bibimbap', cuisineId: 'korean', dishId: 'bibimbap',
    tags: ['Arroz', 'Res', 'Picante'], flavorTags: ['spicy', 'umami'], mealSlots: ['lunch', 'dinner'], time: [30, 35], servings: 2, difficulty: 'medium', rating: [380, 82],
    ingredients: [ri('ing_rice', 180, 'g'), ri('ing_groundbeef', 200, 'g'), ri('ing_egg', 2, 'unit'), ri('ing_spinach', 100, 'g'), ri('ing_carrot', 1, 'unit', 'en julianas'), ri('ing_gochujang', 2, 'tbsp'), ri('ing_soysauce', 1, 'tbsp'), ri('ing_sesameoil', 1, 'tbsp')],
    steps: quick([
      ['Cocina el arroz', 'Cocina el arroz tapado a fuego bajo.', 1080, 2],
      ['Saltea los vegetales y la carne', 'Saltea zanahoria y espinaca por separado; luego dora la carne con la salsa de soya.', 480, 7],
      ['Arma el bowl', 'Sirve el arroz, acomoda todo encima, agrega un huevo frito y el gochujang.', 240, 5],
    ]),
  },
  {
    id: 'rcp_01GIMBAP', title: 'Gimbap', slug: 'gimbap', cuisineId: 'korean', dishId: null,
    tags: ['Arroz', 'Huevo'], flavorTags: ['umami'], mealSlots: ['lunch', 'snack2'], time: [35, 40], servings: 2, difficulty: 'medium',
    ingredients: [ri('ing_rice', 180, 'g'), ri('ing_nori', 3, 'unit'), ri('ing_egg', 2, 'unit'), ri('ing_carrot', 1, 'unit'), ri('ing_cucumber', 1, 'unit'), ri('ing_sesameoil', 1, 'tbsp')],
    steps: quick([
      ['Prepara el arroz', 'Cocina el arroz y mézclalo con el aceite de ajonjolí.', 1080, 2],
      ['Prepara el relleno', 'Haz una tortilla delgada con los huevos y corta todo en tiras.', 300, 5],
      ['Enrolla', 'Extiende arroz sobre el nori, acomoda el relleno, enrolla apretado y corta.', 420, 0],
    ]),
  },
  {
    id: 'rcp_01GRANOLA', title: 'Granola bowl', slug: 'granola-bowl', cuisineId: 'international', dishId: null,
    tags: ['Desayuno', 'Rápida'], flavorTags: ['sweet'], mealSlots: ['breakfast', 'snack1'], time: [5, 5], servings: 1, difficulty: 'easy',
    ingredients: [ri('ing_yogurt', 200, 'g'), ri('ing_granola', 50, 'g'), ri('ing_banana', 1, 'unit'), ri('ing_honey', 1, 'tbsp')],
    steps: quick([['Arma el bowl', 'Sirve el yogur, agrega la granola, el banano en rodajas y la miel.', 300, 0]]),
  },
  {
    id: 'rcp_01AREPAHUEVO', title: 'Arepa con huevo', slug: 'arepa-con-huevo', cuisineId: 'colombian', dishId: 'arepa',
    tags: ['Desayuno', 'Colombiana'], flavorTags: ['cheese'], mealSlots: ['breakfast'], time: [20, 20], servings: 2, difficulty: 'easy', rating: [470, 101],
    ingredients: [ri('ing_arepaflour', 150, 'g'), ri('ing_egg', 2, 'unit'), ri('ing_freshcheese', 60, 'g'), ri('ing_salt', 1, 'pinch'), ri('ing_oliveoil', 1, 'tbsp')],
    steps: quick([
      ['Haz la masa', 'Mezcla la harina con agua tibia y sal hasta que no se pegue a las manos. Forma dos arepas.', 300, 0],
      ['Asa las arepas', 'Asa en sartén con un poco de aceite, 5 minutos por lado.', 600, 5],
      ['Agrega el huevo', 'Abre cada arepa, rellena con queso y sirve con un huevo frito.', 240, 5],
    ]),
  },
  {
    id: 'rcp_01AJIACO', title: 'Ajiaco', slug: 'ajiaco', cuisineId: 'colombian', dishId: 'soups',
    tags: ['Sopa', 'Pollo', 'Colombiana'], flavorTags: ['comfort', 'creamy', 'avocado'], mealSlots: ['lunch'], time: [55, 60], servings: 4, difficulty: 'medium', rating: [540, 112],
    ingredients: [ri('ing_chickenbreast', 500, 'g'), ri('ing_potato_criolla', 600, 'g'), ri('ing_onion', 1, 'unit'), ri('ing_cream', 100, 'ml'), ri('ing_avocado', 1, 'unit'), ri('ing_cilantro', 1, 'unit'), ri('ing_salt', 2, 'pinch')],
    steps: quick([
      ['Cocina el pollo', 'Cocina el pollo con la cebolla en 2 litros de agua. Retira y desmecha.', 1500, 6],
      ['Agrega la papa', 'Agrega la papa criolla y cocina hasta que se deshaga y espese el caldo.', 1500, 4],
      ['Sirve', 'Devuelve el pollo y sirve con crema, aguacate y cilantro.', 120, 0],
    ]),
  },
  {
    id: 'rcp_01TACOSPASTOR', title: 'Tacos al pastor', slug: 'tacos-al-pastor', cuisineId: 'mexican', dishId: 'tacos',
    tags: ['Cerdo', 'Picante'], flavorTags: ['spicy', 'sweet'], mealSlots: ['lunch', 'dinner'], time: [30, 35], servings: 3, difficulty: 'medium', rating: [400, 88],
    ingredients: [ri('ing_pork', 450, 'g', 'en tiras'), ri('ing_pineapple', 150, 'g'), ri('ing_tortilla', 9, 'unit'), ri('ing_onion', 1, 'unit'), ri('ing_cilantro', 1, 'unit'), ri('ing_lemon', 2, 'unit'), ri('ing_paprika', 2, 'tsp')],
    steps: quick([
      ['Marina el cerdo', 'Mezcla el cerdo con paprika, jugo de un limón y sal. Deja 10 minutos.', 600, 0],
      ['Dora el cerdo y la piña', 'Dora el cerdo a fuego alto; agrega la piña en cubos al final.', 600, 8],
      ['Arma los tacos', 'Calienta las tortillas y sirve con cebolla, cilantro y limón.', 300, 4],
    ]),
  },
  {
    id: 'rcp_01POKESALMON', title: 'Poke de salmón', slug: 'poke-de-salmon', cuisineId: 'hawaiian', dishId: 'poke',
    tags: ['Pescado', 'Fresca'], flavorTags: ['fresh', 'avocado', 'umami'], mealSlots: ['lunch', 'dinner'], time: [20, 25], servings: 2, difficulty: 'easy', rating: [430, 90],
    ingredients: [ri('ing_salmon', 250, 'g', 'en cubos'), ri('ing_rice', 160, 'g'), ri('ing_avocado', 1, 'unit'), ri('ing_cucumber', 1, 'unit'), ri('ing_soysauce', 2, 'tbsp'), ri('ing_sesameoil', 1, 'tbsp')],
    steps: quick([
      ['Cocina el arroz', 'Cocina el arroz y déjalo entibiar.', 1080, 2],
      ['Marina el salmón', 'Mezcla el salmón con soya y aceite de ajonjolí.', 300, 0],
      ['Arma el bowl', 'Sirve arroz, salmón, aguacate y pepino en tajadas.', 180, 0],
    ]),
  },
  {
    id: 'rcp_01PANCAKES', title: 'Pancakes de avena', slug: 'pancakes-de-avena', cuisineId: 'american', dishId: 'pancakes',
    tags: ['Desayuno', 'Avena'], flavorTags: ['sweet', 'plantain'], mealSlots: ['breakfast', 'snack1'], time: [15, 20], servings: 2, difficulty: 'easy', rating: [390, 84],
    ingredients: [ri('ing_oats', 100, 'g'), ri('ing_egg', 2, 'unit'), ri('ing_banana', 1, 'unit'), ri('ing_oatdrink', 120, 'ml'), ri('ing_honey', 1, 'tbsp')],
    steps: quick([
      ['Licúa la mezcla', 'Licúa avena, huevos, banano y bebida de avena hasta tener una mezcla espesa.', 120, 0],
      ['Cocina los pancakes', 'Vierte porciones en sartén antiadherente y voltea cuando salgan burbujas.', 600, 4],
      ['Sirve', 'Sirve con miel.', 60, 0],
    ]),
  },
  {
    id: 'rcp_01BACALAO', title: 'Bacalao al horno', slug: 'bacalao-al-horno', cuisineId: 'international', dishId: null,
    tags: ['Pescado', 'Horno'], flavorTags: ['fresh'], mealSlots: ['dinner', 'lunch'], time: [30, 35], servings: 2, difficulty: 'easy',
    ingredients: [ri('ing_cod', 350, 'g'), ri('ing_potato_criolla', 300, 'g'), ri('ing_tomato', 2, 'unit'), ri('ing_garlic', 2, 'clove'), ri('ing_oliveoil', 2, 'tbsp'), ri('ing_lemon', 1, 'unit')],
    steps: quick([
      ['Prepara la bandeja', 'Acomoda papas en mitades, tomate y ajo con aceite en una bandeja. Hornea 15 minutos a 200 °C.', 900, 0],
      ['Hornea el pescado', 'Agrega el bacalao, rocía limón y hornea 12 minutos más.', 720, 0],
    ]),
  },
  {
    id: 'rcp_01ESPARRAGOS', title: 'Espárragos salteados', slug: 'esparragos-salteados', cuisineId: 'international', dishId: 'salads',
    tags: ['Veggie', 'Rápida'], flavorTags: ['fresh', 'cheese'], mealSlots: ['lunch', 'dinner', 'snack2'], time: [12, 15], servings: 2, difficulty: 'easy',
    ingredients: [ri('ing_asparagus', 250, 'g'), ri('ing_garlic', 2, 'clove'), ri('ing_oliveoil', 1, 'tbsp'), ri('ing_lemon', 1, 'unit'), ri('ing_pecorino', 20, 'g')],
    steps: quick([
      ['Saltea los espárragos', 'Saltea los espárragos con aceite y ajo a fuego medio alto.', 360, 7],
      ['Termina', 'Termina con limón y pecorino rallado.', 60, 0],
    ]),
  },
  {
    id: 'rcp_01KATSU', title: 'Katsu de pollo', slug: 'katsu-de-pollo', cuisineId: 'japanese', dishId: null,
    tags: ['Pollo', 'Arroz'], flavorTags: ['umami'], mealSlots: ['lunch', 'dinner'], time: [30, 35], servings: 2, difficulty: 'medium',
    ingredients: [ri('ing_chickenbreast', 300, 'g'), ri('ing_flour', 60, 'g'), ri('ing_egg', 1, 'unit'), ri('ing_rice', 160, 'g'), ri('ing_oliveoil', 4, 'tbsp')],
    steps: quick([
      ['Apana el pollo', 'Aplana las pechugas, pásalas por harina y huevo batido.', 300, 0],
      ['Fríe', 'Fríe en aceite caliente 4 minutos por lado.', 480, 7],
      ['Sirve', 'Corta en tiras y sirve sobre arroz.', 60, 0],
    ]),
  },
  {
    id: 'rcp_01PASTAMARINERA', title: 'Pasta marinera', slug: 'pasta-marinera', cuisineId: 'italian', dishId: 'pasta',
    tags: ['Pasta', 'Mariscos'], flavorTags: ['fresh'], mealSlots: ['lunch', 'dinner'], time: [25, 25], servings: 2, difficulty: 'easy',
    ingredients: [ri('ing_spaghetti', 180, 'g'), ri('ing_shrimp', 250, 'g'), ri('ing_tomato', 3, 'unit'), ri('ing_garlic', 3, 'clove'), ri('ing_oliveoil', 2, 'tbsp')],
    steps: quick([
      ['Cocina la pasta', 'Cocina el espagueti al dente.', 600, 8],
      ['Haz la salsa', 'Sofríe ajo, agrega tomate picado y luego los camarones 3 minutos.', 600, 6],
      ['Une', 'Mezcla la pasta con la salsa y sirve.', 60, 3],
    ]),
  },
  // Comunidad
  {
    id: 'rcp_01SOPAPOLLO', title: 'Sopa de pollo y papa criolla', slug: 'sopa-de-pollo-y-papa-criolla', cuisineId: 'colombian', dishId: 'soups',
    tags: ['Sopa', 'Pollo'], flavorTags: ['comfort'], mealSlots: ['lunch', 'dinner'], time: [35, 35], servings: 4, difficulty: 'medium',
    author: 'usr_01VALENTINA', likes: 248, chefConsultable: true, publishedDaysAgo: 2,
    ingredients: [ri('ing_chickenbreast', 400, 'g'), ri('ing_potato_criolla', 400, 'g'), ri('ing_spaghetti', 100, 'g'), ri('ing_carrot', 2, 'unit'), ri('ing_onion', 1, 'unit'), ri('ing_cilantro', 1, 'unit')],
    steps: quick([
      ['Haz el caldo', 'Cocina el pollo con cebolla y zanahoria en 2 litros de agua.', 1200, 6],
      ['Agrega papa y fideos', 'Agrega la papa criolla y los fideos hasta que estén blandos.', 600, 5],
      ['Sirve', 'Desmecha el pollo, devuélvelo y sirve con cilantro.', 120, 0],
    ]),
  },
  {
    id: 'rcp_01ARROZPOLLO', title: 'Arroz cremoso de pollo', slug: 'arroz-cremoso-de-pollo', cuisineId: 'colombian', dishId: null,
    tags: ['Arroz', 'Pollo', 'Cremosa'], flavorTags: ['creamy', 'comfort'], mealSlots: ['lunch', 'dinner'], time: [30, 30], servings: 2, difficulty: 'easy',
    author: 'usr_01NICOLAS', likes: 131, chefConsultable: true, publishedDaysAgo: 4,
    ingredients: [ri('ing_rice', 160, 'g'), ri('ing_chickenbreast', 250, 'g'), ri('ing_cream', 100, 'ml'), ri('ing_tomato', 1, 'unit'), ri('ing_onion', 1, 'unit')],
    steps: quick([
      ['Sofríe', 'Sofríe cebolla y tomate; agrega el pollo en cubos.', 480, 6],
      ['Cocina el arroz', 'Agrega el arroz y el doble de agua; cocina tapado a fuego bajo.', 1080, 2],
      ['Termina cremoso', 'Incorpora la crema al final y deja reposar 2 minutos.', 120, 0],
    ]),
  },
];

export const COMMUNITY_USERS = [
  { id: 'usr_01VALENTINA', name: 'Valentina', lastName: 'Rojas', email: 'valentina@noshy.dev' },
  { id: 'usr_01NICOLAS', name: 'Nicolás', lastName: 'Pérez', email: 'nicolas@noshy.dev' },
  { id: 'usr_01LAURA', name: 'Laura', lastName: 'Mejía', email: 'laura@noshy.dev' },
  { id: 'usr_01ALEJO', name: 'Alejo', lastName: 'Gómez', email: 'alejo@noshy.dev' },
  { id: 'usr_01SOFI', name: 'Sofi', lastName: 'Duarte', email: 'sofi@noshy.dev' },
];

export type { MacrosWithFiber, UserStep };
