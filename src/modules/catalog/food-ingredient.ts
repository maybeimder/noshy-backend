import { createHash } from 'node:crypto';
import type { FoodDoc } from '../../infrastructure/database/mongo/collections.js';
import { CATEGORY_LABELS } from '../../core/domain/catalog.js';
import type { Unit } from '../../core/domain/quantity.js';
import type { IngredientRow } from './catalog.repository.js';
import { normalizeText } from './food-text.js';

/**
 * Convierte un alimento de `products_slim` (Mongo) en un ingrediente de Noshy. Todo lo que la API guarda
 * (despensa, lista, recetas) apunta a un ingrediente, así que el alimento elegido se copia a Postgres con este formato.
 */
const PREFIX = 'food_';
const TEXT_PREFIX = 'txt_';
/** `ingredientId` admite 64 caracteres en los DTO. */
const MAX_ID = 64;

export const foodIngredientId = (foodId: string): string => `${PREFIX}${foodId}`;
export const isFoodIngredientId = (id: string): boolean => id.startsWith(PREFIX) && id.length > PREFIX.length && id.length <= MAX_ID;
/** Ingrediente propio de Noshy: el que usan las recetas, los sustitutos y los precios. */
export const isBaseIngredientId = (id: string): boolean => id.startsWith('ing_');
export const foodIdOf = (ingredientId: string): string => ingredientId.slice(PREFIX.length);

export const foodName = (d: FoodDoc): string => (d.displayName ?? d.name).trim();
export const foodBrand = (d: FoodDoc): string => d.brand?.trim() || 'generic';

/** «Arroz» de dos marcas debe distinguirse en la lista: el front solo muestra `label`. */
export function foodLabel(d: FoodDoc): string {
  const name = foodName(d);
  const brand = foodBrand(d);
  return brand === 'generic' || normalizeText(name).includes(normalizeText(brand)) ? name : `${name} · ${brand}`;
}

const words = (...list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`);
const stripTag = (tag: string) => tag.replace(/^[a-z]{2}:/, '').toLowerCase();

// ---------- Alérgenos y dieta ----------
// Los datos de Open Food Facts son de la comunidad y vienen incompletos: se suma lo declarado con lo que dice el texto.
const OFF_ALLERGENS: Record<string, string> = {
  gluten: 'gluten', milk: 'lactose', eggs: 'egg', nuts: 'nuts', peanuts: 'nuts', crustaceans: 'shellfish', molluscs: 'shellfish',
};

const FISH = words('pescados?', 'salmon', 'atun', 'bacalao', 'tilapia', 'trucha', 'sardinas?', 'anchoas?', 'mojarra', 'robalo', 'merluza', 'bagre', 'corvina', 'fish', 'tuna', 'cod', 'anchov(?:y|ies)', 'trout', 'halibut', 'catfish', 'haddock', 'snapper');
const SHELLFISH = words('mariscos?', 'camaron(?:es)?', 'langostinos?', 'cangrejos?', 'langostas?', 'almejas?', 'ostras?', 'mejillon(?:es)?', 'calamar(?:es)?', 'pulpo', 'shrimps?', 'prawns?', 'crab', 'squid', 'lobsters?', 'clams?', 'oysters?', 'scallops?', 'mussels?', 'crabmeat', 'octopus', 'vieiras?', 'gambas?', 'jaibas?');
const POULTRY = words('pollo', 'gallina', 'pavo', 'pechugas?', 'contramuslos?', 'muslos?', 'chicken', 'turkey', 'duck', 'pato');
const MEAT = words(
  'res', 'carnes?', 'ternera', 'cerdo', 'jamon', 'tocino', 'tocineta', 'chicharron', 'chorizos?', 'salchichas?', 'salchichon', 'mortadela', 'butifarra',
  'morcilla', 'cordero', 'costillas?', 'hamburguesas?', 'salami', 'pepperoni', 'longaniza', 'lomo', 'higado', 'gelatina', 'beef', 'pork', 'ham', 'bacon', 'gelatin', 'steak', 'sausages?', 'veal', 'lamb', 'meatballs?', 'hot dogs?', 'tocino', 'albondigas?');
const DAIRY = words('leche', 'mantequilla', 'quesos?', 'quesito', 'queso crema', 'cremas?', 'nata', 'yogurt?', 'yogures', 'kumis', 'cuajada', 'arequipe', 'suero', 'lactosa', 'lacteos?', 'mozzarella', 'parmesano', 'ricotta', 'milk', 'butter', 'cheese', 'whey', 'lactose', 'buttermilk', 'cream', 'yoghurt', 'cheddar', 'parmesan', 'half-and-half', 'ghee');
const EGG = words('huevos?', 'claras?', 'yemas?', 'mayonesa', 'albumina', 'eggs?', 'mayonnaise', 'mayo');
const GLUTEN = words('trigo', 'cebada', 'centeno', 'harina', 'pan', 'pan rallado', 'apanad[oa]s?', 'pastas?', 'espaguetis?', 'spaghetti', 'macarron(?:es)?', 'fideos', 'galletas?', 'cerveza', 'salsa de soya', 'cuscus', 'semola', 'tallarin(?:es)?', 'lasana', 'panko', 'hojaldre', 'raviolis?', 'espaguetis?', 'gluten', 'wheat', 'barley', 'rye', 'flour', 'bread', 'breadcrumbs', 'bread crumbs', 'crackers?', 'noodles?', 'macaroni', 'lasagna', 'couscous', 'cous cous', 'croutons', 'soy sauce', 'biscuits?', 'bisquick', 'bulgur', 'seitan');
const NUTS = words('nuez', 'nueces', 'almendras?', 'maranon(?:es)?', 'avellanas?', 'pistachos?', 'macadamias?', 'pecanas?', 'mani', 'cacahuates?', 'frutos secos', 'nuts', 'almonds?', 'peanuts?', 'hazelnuts?', 'walnuts?', 'pecans?', 'cashews?', 'pistachios', 'marzipan', 'pesto');
const HONEY = words('miel', 'honey');

// Frases que traen una palabra del léxico pero no ese alimento.
const NOT_DAIRY = /\b(?:leche|crema|queso|bebida|yogurt?) (?:de|vegetal(?: de)?) (?:coco|almendras?|soya|soja|avena|arroz|mani)\b|\b(?:peanut|almond|cashew|apple|cocoa|coconut|soy|oat|rice) (?:butter|milk|cream)\b|\bcream of tartar\b|\bbutter (?:beans?|lettuce)\b|\b(?:mantequilla|crema) de (?:mani|cacao|almendras?)\b|\bmanteca de cacao\b/g;
const NOT_GLUTEN = /\bharina de (?:maiz|arroz|almendras?|yuca|coco|avena|garbanzos?|platano)\b|\b(?:pastas?|fideos) de (?:tomate|mani|ajo|arroz|garbanzos?|aji)\b|\bpan de yuca\b|\b(?:rice|almond|corn|coconut|potato|tapioca) (?:flour|noodles?|pasta)\b|\bgluten free \w+/g;
const NOT_NUTS = /\bnuez moscada\b|\bnutmeg\b/g;
const NOT_MEAT = /\blomos? de (?:atun|salmon|pescado|tilapia|trucha)\b|\b(?:hamburguesas?|chorizos?|salchichas?|carnes?) (?:vegetal(?:es)?|vegan[oa]s?|de (?:lentejas?|soya|soja|garbanzos?))\b/g;
/** «Puede contener trazas de…» no es «contiene». */
const TRACES = /(?:puede contener|trazas de|may contain)(?:(?!\bcontiene\b)[^.;])*/g;
const FLAVOR = /\bsabor(?: (?:a|al|de))? \w+/g;
/** «Sin lactosa», «libre de gluten», «0% lactosa»: la palabra aparece justo porque no lo contiene. */
const FREE_FROM = /\b(?:sin|libre de|cero|0 ?%)(?: adicion de)? \w+/g;

type Facts = { allergens: string[]; dietFlags: string[] };

function facts(d: FoodDoc): Facts {
  const clean = (text: string) => normalizeText(text).replace(TRACES, ' ').replace(FLAVOR, ' ').replace(FREE_FROM, ' ');
  const text = clean(`${foodName(d)} | ${d.ingredients ?? ''}`);
  const tags = new Set([...(d.dietTags ?? []), ...(d.labels ?? [])].map(stripTag));
  const groups = new Set((d.foodGroups ?? []).map(stripTag));
  const has = (...g: string[]) => g.some((x) => groups.has(x));

  const vegan = tags.has('vegan');
  const vegetarian = vegan || tags.has('vegetarian');
  const allergens = new Set((d.allergens ?? []).flatMap((a) => OFF_ALLERGENS[stripTag(a)] ?? []));
  const dietFlags = new Set<string>();

  const dairy = !vegan && (allergens.has('lactose') || DAIRY.test(text.replace(NOT_DAIRY, ' ')) || has('milk-and-dairy-products', 'milk-and-yogurt', 'cheese', 'dairy-desserts'));
  const egg = !vegan && (allergens.has('egg') || EGG.test(text) || has('eggs'));
  const fish = !vegetarian && ((d.allergens ?? []).some((a) => stripTag(a) === 'fish') || FISH.test(text) || has('fish', 'fish-and-seafood'));
  const shellfish = allergens.has('shellfish') || (!vegetarian && SHELLFISH.test(text));
  const meatText = text.replace(NOT_MEAT, ' ');
  const meat = !vegetarian && (POULTRY.test(meatText) || MEAT.test(meatText) || has('meat', 'poultry', 'processed-meat', 'offals'));

  if (dairy) allergens.add('lactose');
  if (egg) allergens.add('egg');
  if (shellfish) allergens.add('shellfish');
  if (GLUTEN.test(text.replace(NOT_GLUTEN, ' '))) allergens.add('gluten');
  if (NUTS.test(text.replace(NOT_NUTS, ' '))) allergens.add('nuts');

  const nameAndLabels = normalizeText([foodName(d), ...(d.labels ?? [])].join(' | ')).replace(/-/g, ' ');
  if (/deslactosad|sin lactosa|no lactose|lactose free/.test(nameAndLabels)) allergens.delete('lactose');
  if (/sin gluten|libre de gluten|no gluten|gluten free/.test(nameAndLabels)) allergens.delete('gluten');

  if (meat) dietFlags.add('meat');
  if (fish) dietFlags.add('fish');
  if (shellfish) dietFlags.add('shellfish');
  if (dairy) dietFlags.add('dairy');
  if (egg) dietFlags.add('egg');
  if (dietFlags.size || (!vegan && HONEY.test(text))) dietFlags.add('animal');
  return { allergens: [...allergens], dietFlags: [...dietFlags] };
}

// ---------- Categoría, lugar y vida útil ----------
type Shelf = { categoryId: string; storage: 'fridge' | 'pantry' | 'freezer'; life: number; icon: string };

const PROCESSED_MEAT = words('salchichas?', 'salchichon', 'jamon', 'mortadela', 'chorizos?', 'butifarra', 'salami', 'pepperoni', 'tocineta', 'longaniza');
const HEAD_DAIRY = /^(?:leche|quesos?|quesito|yogurt?|kumis|mantequilla|crema de leche|crema agria|cuajada|suero)\b/;
const HEAD_BAKERY = /^(?:pan|panes|galletas?|tostadas?|tortillas?|arepas?|ponque|torta|croissant|almojabanas?|pandebono)\b/;
const HEAD_DRINK = /^(?:jugo|nectar|gaseosa|bebida|agua|te|cafe|cerveza|vino|refresco|malta|limonada|energizante)\b/;
const HEAD_SPICE = /^(?:sal|pimientas?|comino|oregano|canela|curcuma|paprika|laurel|tomillo|romero|nuez moscada|clavos?|color|azafran|adobo|sazonador|condimento|curry|ajo en polvo|cebolla en polvo)\b/;
const SHELF_STABLE = /\b(?:enlatad[oa]s?|lata|conserva|lomitos|en polvo|deshidratad[oa]s?|sec[oa]s?|pasas?|aceite|salsa|mermelada|compota|pulpa|encurtid[oa]s?)\b/;

function shelf(d: FoodDoc): Shelf {
  const name = normalizeText(foodName(d)).replace(FLAVOR, ' ');
  const groups = new Set((d.foodGroups ?? []).map(stripTag));
  const has = (...g: string[]) => g.some((x) => groups.has(x));
  const frozen = /\b(?:congelad[oa]s?|helados?)\b/.test(name) || has('ice-cream');
  const stable = d.state === 'canned' || SHELF_STABLE.test(name);
  const at = (categoryId: string, storage: Shelf['storage'], life: number, icon: string): Shelf =>
    frozen ? { categoryId, storage: 'freezer', life: 120, icon } : { categoryId, storage, life, icon };
  const pantry = (icon = 'jar', life = 270) => at('staples', 'pantry', life, icon);
  const plantBased = name.search(NOT_DAIRY) >= 0;

  if (has('salty-snacks', 'sugary-snacks', 'sweets', 'chocolate-products', 'appetizers', 'breakfast-cereals')) return pantry('cookie', 180);
  if (HEAD_SPICE.test(name)) return at('spices', 'pantry', 720, 'salt');
  if (/^huevos?\b/.test(name) || has('eggs')) return at('protein', 'fridge', 21, 'egg');
  if (HEAD_BAKERY.test(name) || has('bread', 'biscuits-and-cakes')) return at('bakery', 'pantry', /^(?:galletas?|tostadas?)/.test(name) ? 120 : 7, 'bread');
  if (plantBased) return /mantequilla|crema/.test(name) ? pantry() : at('drinks', 'fridge', 7, 'glass');
  if (HEAD_DAIRY.test(name) || has('milk-and-yogurt', 'cheese', 'dairy-desserts')) {
    if (/en polvo|condensada|evaporada/.test(name)) return at('dairy', 'pantry', 270, 'bottle');
    if (/^ques/.test(name) || has('cheese')) return at('dairy', 'fridge', 20, 'cheese');
    if (/^mantequilla/.test(name)) return at('dairy', 'fridge', 60, 'butter');
    return at('dairy', 'fridge', 10, /^(?:yogur|kumis)/.test(name) ? 'cup' : 'bottle');
  }
  if (HEAD_DRINK.test(name) || has('sweetened-beverages', 'artificially-sweetened-beverages', 'unsweetened-beverages', 'fruit-juices', 'teas-and-herbal-teas-and-coffees', 'alcoholic-beverages', 'waters-and-flavored-waters')) {
    return at('drinks', 'pantry', /^(?:te|cafe)\b/.test(name) ? 365 : 120, 'glass');
  }
  if (has('one-dish-meals', 'dressings-and-sauces', 'fats')) return pantry(has('fats') ? 'drop' : 'jar', 365);
  if (FISH.test(name) || SHELLFISH.test(name) || has('fish', 'fish-and-seafood')) {
    return stable ? at('seafood', 'pantry', 720, 'can') : at('seafood', 'fridge', 2, SHELLFISH.test(name) ? 'shrimp' : 'fish');
  }
  if (PROCESSED_MEAT.test(name) || has('processed-meat')) return at('protein', 'fridge', 20, 'meat');
  if (POULTRY.test(name) || has('poultry')) return at('protein', 'fridge', 3, 'drumstick');
  if ((MEAT.test(name.replace(NOT_MEAT, ' ')) || has('meat', 'offals')) && !/gelatina/.test(name)) return at('protein', 'fridge', 3, 'meat');
  if (/\btofu\b/.test(name)) return at('protein', 'fridge', 10, 'tofu');
  if (has('fruits', 'vegetables', 'fruits-and-vegetables', 'potatoes') && d.nova !== 4) return stable ? pantry('can', 365) : at('produce', 'fridge', 7, 'leaf');
  if (has('legumes')) return pantry('legume', 365);
  if (has('cereals')) return pantry('rice', 365);
  return pantry();
}

// ---------- Unidades ----------
const FRACTIONS: Record<string, number> = { '1/2': 0.5, '½': 0.5, '1/4': 0.25, '¼': 0.25, '1/3': 1 / 3, '3/4': 0.75, '¾': 0.75 };
const SERVING_UNITS: [RegExp, Unit][] = [
  [/^(?:cucharadas?|cdas?|tbsp)\b/, 'tbsp'],
  [/^(?:cucharaditas?|cdtas?|tsp)\b/, 'tsp'],
  [/^(?:tazas?|cups?)\b/, 'cup'],
  [/^dientes?\b/, 'clove'],
  [/^(?:unidad(?:es)?|und?|u|pieza|huevo|fruta)\b/, 'unit'],
];

/** Gramos por medida casera según las porciones del producto: «1 taza» de arroz = 185 g. */
function gramsPerUnit(d: FoodDoc): Partial<Record<Unit, number>> {
  const out: Partial<Record<Unit, number>> = {};
  for (const s of d.servings ?? []) {
    const m = /^(1\/2|1\/4|1\/3|3\/4|[½¼¾]|\d+(?:[.,]\d+)?)?\s*(.+)$/.exec(normalizeText(s.label ?? '').trim());
    if (!m || !(s.grams > 0)) continue;
    const n = m[1] ? (FRACTIONS[m[1]] ?? Number(m[1].replace(',', '.'))) : 1;
    const unit = SERVING_UNITS.find(([re]) => re.test(m[2]!))?.[1];
    if (unit && n > 0) out[unit] ??= Math.round((s.grams / n) * 10) / 10;
  }
  return out;
}

/** «500 g», «1,1 kg», «6 x 200 ml», «30 unidades». */
export function parsePack(text: string | null | undefined): { value: number; unit: 'g' | 'ml' | 'unit' } | null {
  const m = /(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilos?|gramos|grs?|g|ml|cc|cl|litros?|lt|l|unidades|unidad|und|un)\b/.exec(normalizeText(text ?? ''));
  if (!m) return null;
  const u = m[3]!;
  const small = /^(?:g|ml|cc)/.test(u);
  // «1.100 g» lleva separador de miles; «1.5 kg», decimal.
  const n = Number(small && /^\d{1,3}[.,]\d{3}$/.test(m[2]!) ? m[2]!.replace(/[.,]/, '') : m[2]!.replace(',', '.')) * Number(m[1] ?? 1);
  if (!(n > 0)) return null;
  const round = (v: number) => Math.round(v * 100) / 100;
  if (/^k/.test(u)) return { value: round(n * 1000), unit: 'g' };
  if (/^g/.test(u)) return { value: round(n), unit: 'g' };
  if (u === 'cl') return { value: round(n * 10), unit: 'ml' };
  if (/^l/.test(u)) return { value: round(n * 1000), unit: 'ml' };
  if (/^(?:ml|cc)$/.test(u)) return { value: round(n), unit: 'ml' };
  return { value: round(n), unit: 'unit' };
}

const LIQUID_NAME = /^(?:leche|jugo|nectar|aceite|vinagre|agua|gaseosa|bebida|cerveza|vino|crema de leche)\b/;

function units(d: FoodDoc): Pick<IngredientRow, 'defaultUnit' | 'allowedUnits' | 'gramsPerUnit' | 'unitLabel' | 'typicalPack'> {
  const pack = parsePack(d.quantity);
  const gpu = gramsPerUnit(d);
  const liquid = pack?.unit === 'ml' || (pack?.unit !== 'g' && LIQUID_NAME.test(normalizeText(foodName(d))) && !/en polvo/.test(normalizeText(foodName(d))));
  const base: Unit = liquid ? 'ml' : 'g';
  const perUnit = gpu.unit !== undefined;
  // Sin «1 unidad» en sus porciones, la unidad de un producto empacado es el empaque.
  let unitLabel: [string, string] | null = null;
  if (!perUnit && pack && pack.unit !== 'unit') {
    gpu.unit = pack.value;
    unitLabel = ['paquete', 'paquetes'];
  }
  const allowed = new Set<Unit>(liquid ? ['ml', 'l', 'cup', 'tbsp'] : ['g', 'kg']);
  for (const u of Object.keys(gpu) as Unit[]) allowed.add(u);
  if (pack?.unit === 'unit') allowed.add('unit');
  const typical = pack ?? { value: 500, unit: base };
  return {
    defaultUnit: perUnit || pack?.unit === 'unit' ? 'unit' : base,
    allowedUnits: [...allowed],
    gramsPerUnit: gpu,
    unitLabel,
    typicalPack: { ...typical, label: `${typical.value.toLocaleString('es-CO')} ${typical.unit === 'unit' ? 'und' : typical.unit}` },
  };
}

function nutrition(d: FoodDoc): IngredientRow['nutritionPer100g'] {
  const n = d.per100g ?? {};
  const { kcal, protein_g: proteinG, carbs_g: carbsG, fat_g: fatG } = n;
  if (typeof kcal !== 'number' || typeof proteinG !== 'number' || typeof carbsG !== 'number' || typeof fatG !== 'number') return null;
  return { kcal, proteinG, carbsG, fatG, fiberG: n.fiber_g ?? 0 };
}

export function ingredientFromFood(d: FoodDoc): IngredientRow {
  const s = shelf(d);
  const label = foodLabel(d);
  return {
    id: foodIngredientId(d._id),
    label,
    icon: s.icon,
    categoryId: s.categoryId,
    categoryLabel: CATEGORY_LABELS[s.categoryId]!,
    defaultStorage: s.storage,
    shelfLifeDays: s.life,
    ...facts(d),
    flavorTags: [],
    nutritionPer100g: nutrition(d),
    ...units(d),
    isBasic: s.categoryId === 'spices',
    searchText: normalizeText(label),
  };
}

/**
 * Ingrediente de texto libre. El id sale del texto: escribir lo mismo da el mismo ingrediente.
 * Alérgenos, dieta y lugar se deducen del texto igual que con un producto.
 */
export function ingredientFromText(text: string): IngredientRow {
  const clean = text.trim().replace(/\s+/g, ' ');
  const label = clean.charAt(0).toLocaleUpperCase('es') + clean.slice(1);
  return {
    ...ingredientFromFood({ _id: '', name: label, search: '' }),
    id: `${TEXT_PREFIX}${createHash('sha256').update(label).digest('hex').slice(0, 24)}`,
    defaultUnit: 'unit',
    allowedUnits: ['unit', 'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp'],
    gramsPerUnit: {},
    unitLabel: null,
    typicalPack: { value: 1, unit: 'unit', label: '1 und' },
  };
}

/** Alérgenos que se leen en un texto (español o inglés). */
export const allergensIn = (text: string): string[] => facts({ _id: '', name: text, search: '' }).allergens;
