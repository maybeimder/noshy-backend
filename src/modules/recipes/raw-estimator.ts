import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';
import type { Difficulty, MealSlotId } from '../../core/domain/catalog.js';
import type { Macros } from '../../core/domain/nutrition.js';
import type { Unit } from '../../core/domain/quantity.js';
import { allergensIn } from '../catalog/food-ingredient.js';
import { RAW_FOODS, gramsPerUnitOf, type RawFood } from './raw-foods.js';

/**
 * Macros de una receta en inglés sin usar un modelo: se lee cada línea («1 1/2 c. flour»), se pasa a gramos y se suma.
 * Solo sirve si se entienden TODAS las líneas: así ni las calorías ni los alérgenos quedan a medias.
 */
export type ParsedIngredient = { food: RawFood; label: string; value: number | null; unit: Unit; grams: number };
export type RawEstimate = {
  title: string;
  ingredients: ParsedIngredient[];
  steps: string[];
  servings: number;
  minutes: number;
  difficulty: Difficulty;
  mealSlots: MealSlotId[];
  perServing: Macros;
};

const FRAC = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*\\.\\d+|\\d+)';
const toNumber = (s: string): number =>
  s
    .trim()
    .split(/\s+/)
    .reduce((a, p) => a + (p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p)), 0);

const WEIGHT: [RegExp, number][] = [
  [/^(?:lbs?|pounds?)\b\.?/, 453.6],
  [/^(?:oz|ounces?)\b\.?/, 28.35],
  [/^(?:kg|kilos?)\b\.?/, 1000],
  [/^(?:g|grams?)\b\.?/, 1],
];
const VOLUME: [RegExp, Unit, number][] = [
  [/^(?:c|cups?)\b\.?/, 'cup', 1],
  [/^(?:tbsps?|tbs|tb|tablespoons?|tbl)\b\.?/, 'tbsp', 1],
  [/^(?:tsps?|teaspoons?)\b\.?/, 'tsp', 1],
  [/^(?:pts?|pints?)\b\.?/, 'cup', 2],
  [/^(?:qts?|quarts?)\b\.?/, 'cup', 4],
  [/^sticks?\b/, 'cup', 0.5],
];
const PACKAGE = /^(?:cans?|pkgs?|packages?|jars?|box(?:es)?|cartons?|bottles?|bags?|containers?|tubs?|envelopes?|tubes?|loaf|loaves|heads?|bunch(?:es)?)\b\.?/;
const PINCH = /^(?:pinch(?:es)?|dash(?:es)?|drops?|sprinkles?)\b/;

const clean = (line: string) =>
  line
    // «T.» es cucharada y «t.» cucharadita: solo se distinguen por la mayúscula.
    .replace(/(^|[\d\s)])T\.?\s/, '$1 tbsp ')
    .replace(/(^|[\d\s)])t\.\s/, '$1 tsp ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[“”"*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Todos los alimentos que nombra el texto, sin los que caen dentro de otro más largo («cream» en «sour cream»). */
function foodsIn(text: string): { food: RawFood; start: number; end: number }[] {
  const hits = RAW_FOODS.flatMap((food) => [...text.matchAll(food.re)].filter((m) => m[0].length > 0).map((m) => ({ food, start: m.index, end: m.index + m[0].length })));
  return hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start)).sort((a, b) => a.start - b.start);
}

export function parseLine(line: string): ParsedIngredient | null {
  const text = clean(line);
  const found = foodsIn(text.replace(/\([^)]*\)/g, ' '));
  const main = found[0];
  if (!main) return null;
  const food = main.food;
  // Nada en la línea puede traer un alérgeno o bandera que el alimento elegido no declare («butter or margarine», «nuts optional»).
  const covers = (list: string[], own: string[]) => list.every((x) => own.includes(x));
  if (!found.every((f) => covers(f.food.allergens, food.allergens) && covers(f.food.diet, food.diet))) return null;
  if (!covers(allergensIn(text), food.allergens)) return null;

  const raw = text.replace(/\([^)]*\)/g, ' ').slice(main.start, main.end).replace(/[^a-z ]+/g, ' ').replace(/ +/g, ' ').trim();
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return amountOf(text, food, label);
}

function amountOf(text: string, food: RawFood, label: string): ParsedIngredient | null {
  const gpu = gramsPerUnitOf(food);
  const taste = (): ParsedIngredient | null => (food.trace || /to taste|for frying|as needed|optional|to grease|for greasing/.test(text) ? { food, label, value: null, unit: 'toTaste', grams: 0 } : null);
  const qty = new RegExp(`^(?:about |approximately |scant |heaping )?(${FRAC})(?:\\s*(?:to|-|or)\\s*${FRAC})?`).exec(text);
  if (!qty) return taste();
  const n = toNumber(qty[1]!);
  if (!(n > 0) || n > 200) return null;
  let rest = text.slice(qty[0].length).replace(/^[\s-]+/, '');
  // «1 (10 3/4 oz.) can», «1 can (16 oz.)», «2 8-oz. pkg.»
  const each = new RegExp(`\\(?\\s*(${FRAC})\\s*-?\\s*(oz|ounces?|lbs?|pounds?)\\b`).exec(rest);
  if (each && (rest.startsWith('(') || PACKAGE.test(rest) || /^\d/.test(rest))) {
    const grams = n * toNumber(each[1]!) * (each[2]!.startsWith('o') ? 28.35 : 453.6);
    return { food, label, value: Math.round(grams), unit: 'g', grams };
  }
  rest = rest.replace(/^\([^)]*\)\s*/, '');
  for (const [re, g] of WEIGHT) if (re.test(rest)) return { food, label, value: Math.round(n * g), unit: 'g', grams: n * g };
  for (const [re, unit, k] of VOLUME) {
    if (!re.test(rest)) continue;
    const g = gpu[unit] ?? null;
    if (g === null) return null;
    return { food, label, value: Math.round(n * k * 100) / 100, unit, grams: n * k * g };
  }
  if (PINCH.test(rest)) return food.trace ? { food, label, value: n, unit: 'pinch', grams: n * 0.5 } : null;
  if (food.trace) return { food, label, value: null, unit: 'toTaste', grams: 0 };
  if (gpu.unit === undefined) return null;
  // Una pieza: «2 eggs», «3 large onions», «1 can corn».
  return { food, label, value: n, unit: 'unit', grams: n * gpu.unit };
}

// ---------- Tipo de plato ----------
type Kind = { grams: number; slots: MealSlotId[] };
const KINDS: [RegExp, Kind][] = [
  [/\b(?:dip|sauce|dressing|marinade|gravy|relish|salsa|spread|frosting|icing|glaze|topping|syrup|jam|jelly|rub|seasoning|mix)\b/, { grams: 45, slots: ['snack1', 'snack2'] }],
  [/\b(?:pancakes?|waffles?|omelett?e|french toast|oatmeal|granola|breakfast|scrambled|quiche|frittata|crepes?)\b/, { grams: 200, slots: ['breakfast'] }],
  [/\b(?:muffins?|biscuits?|scones?|coffee cake|rolls?|bread)\b/, { grams: 80, slots: ['breakfast', 'snack1'] }],
  [/\b(?:cookies?|brownies?|bars?|fudge|candy|cake|cakes|cupcakes?|pie|pies|cheesecake|cobbler|pudding|dessert|tarts?|truffles?|brittle|balls|squares|crisp|torte|mousse|ice cream|sherbet|delight|donuts?|doughnuts?)\b/, { grams: 95, slots: ['snack1', 'snack2'] }],
  [/\b(?:punch|smoothie|shake|lemonade|tea|cocktail|drink|juice|cider|slush|eggnog)\b/, { grams: 240, slots: ['snack1', 'snack2'] }],
  [/\b(?:soup|stew|chowder|chili|bisque|gumbo|broth)\b/, { grams: 380, slots: ['lunch', 'dinner'] }],
  [/\b(?:salad|slaw)\b/, { grams: 200, slots: ['lunch', 'dinner'] }],
];
const PROTEIN = new Set(['protein', 'seafood']);

function kindOf(title: string, ings: ParsedIngredient[]): Kind {
  const t = title.toLowerCase();
  const known = KINDS.find(([re]) => re.test(t));
  // «Pot pie», «meat loaf cake»: con carne es un plato.
  const hasMeat = ings.some((i) => i.food.diet.includes('meat') || PROTEIN.has(i.food.category) && i.food.label !== 'Eggs');
  if (known && !(hasMeat && known[1].slots[0] === 'snack1' && known[1].grams === 95)) return known[1];
  const total = ings.reduce((a, i) => a + i.grams, 0);
  const sugar = ings.filter((i) => /sugar|syrup|honey|chocolate|marshmallow/i.test(i.food.label)).reduce((a, i) => a + i.grams, 0);
  if (sugar / total > 0.18) return { grams: 95, slots: ['snack1', 'snack2'] };
  return hasMeat ? { grams: 300, slots: ['lunch', 'dinner'] } : { grams: 220, slots: ['lunch', 'dinner'] };
}

function minutesOf(steps: string[]): number {
  let total = 10;
  for (const m of steps.join(' ').toLowerCase().matchAll(new RegExp(`(${FRAC})(?:\\s*(?:to|-)\\s*(${FRAC}))?\\s*(minutes?|mins?|hours?|hrs?)\\b`, 'g'))) {
    total += toNumber(m[2] ?? m[1]!) * (m[3]!.startsWith('h') ? 60 : 1);
  }
  return Math.min(360, Math.max(10, Math.round((total === 10 ? 10 + steps.length * 4 : total) / 5) * 5));
}

const titleCase = (t: string) => t.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

export function estimateRaw(doc: RawRecipeDoc): RawEstimate | null {
  const lines = doc.ingredients ?? [];
  const steps = (doc.directions ?? []).map((s) => s.trim()).filter((s) => s.length > 2);
  const title = titleCase(doc.title ?? '');
  if (lines.length < 3 || lines.length > 14 || steps.length === 0 || title.length < 3 || !/[a-z]/i.test(title)) return null;
  const ingredients: ParsedIngredient[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) return null;
    // Dos líneas del mismo alimento («1 c. sugar» y «2 Tbsp. sugar») se juntan si comparten unidad.
    const same = ingredients.find((i) => i.label === parsed.label && i.unit === parsed.unit);
    if (same) {
      same.value = same.value === null || parsed.value === null ? same.value : same.value + parsed.value;
      same.grams += parsed.grams;
    } else ingredients.push(parsed);
  }
  // Algo del título o los pasos que no esté en la lista también puede traer un alérgeno.
  const own = new Set(ingredients.flatMap((i) => [...i.food.allergens, ...i.food.diet]));
  if (allergensIn(title).some((a) => !own.has(a))) return null;
  if (foodsIn(clean(steps.join(' '))).some(({ food }) => [...food.allergens, ...food.diet].some((x) => !own.has(x)))) return null;

  const total = ingredients.reduce((a, i) => a + i.grams, 0);
  const sum = [0, 1, 2, 3].map((k) => ingredients.reduce((a, i) => a + (i.food.per100[k]! * i.grams) / 100, 0));
  const kind = kindOf(title, ingredients);
  const servings = Math.min(24, Math.max(1, Math.round(total / kind.grams)));
  const [kcal, proteinG, carbsG, fatG] = sum.map((x) => Math.round(x / servings)) as [number, number, number, number];
  if (kcal < 40 || kcal > 1_100) return null;
  return {
    title,
    ingredients,
    steps,
    servings,
    minutes: minutesOf(steps),
    difficulty: steps.length <= 4 && ingredients.length <= 7 ? 'easy' : steps.length <= 8 ? 'medium' : 'hard',
    mealSlots: kind.slots,
    perServing: { kcal, proteinG, carbsG, fatG },
  };
}
