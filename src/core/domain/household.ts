import type { Unit } from './quantity.js';

/** Lo que hace falta de un ingrediente para saber cómo se puede medir. */
export type Measurable = {
  searchText: string;
  allowedUnits: Unit[];
  gramsPerUnit: Partial<Record<Unit, number>>;
  typicalPack: { unit: Unit } | null;
};

const MASS: Unit[] = ['g', 'kg'];
const VOLUME: Unit[] = ['ml', 'l'];
const HOUSEHOLD: Unit[] = ['cup', 'tbsp', 'tsp'];

const isLiquid = (i: Pick<Measurable, 'allowedUnits' | 'typicalPack'>): boolean =>
  i.allowedUnits.some((u) => VOLUME.includes(u)) || (i.typicalPack !== null && VOLUME.includes(i.typicalPack.unit));

/** Medidas que se aceptan además de las propias: peso y medidas caseras siempre; ml y l solo en líquidos. */
export const otherUnits = (i: Pick<Measurable, 'allowedUnits' | 'typicalPack'>): Unit[] =>
  [...MASS, ...(isLiquid(i) ? VOLUME : []), ...HOUSEHOLD].filter((u) => !i.allowedUnits.includes(u));

export const acceptsUnit = (i: Pick<Measurable, 'allowedUnits' | 'typicalPack'>, unit: Unit): boolean =>
  i.allowedUnits.includes(unit) || otherUnits(i).includes(unit);

/** Gramos de una taza cuando el ingrediente no lo dice. Sin esto contaría como agua (240 g). */
const CUP_GRAMS: [RegExp, number][] = [
  [/\barroz\b/, 185],
  [/\b(?:quinua|quinoa)\b/, 170],
  [/\b(?:harina|maizena|almidon|fecula)\b/, 125],
  [/\b(?:cuscus|semola)\b/, 175],
  [/\b(?:lentejas?|frijol(?:es)?|garbanzos?|arvejas?|soya|maiz)\b/, 190],
  [/\bavena\b/, 90],
  [/\b(?:granola|cereal|hojuelas)\b/, 110],
  [/\bazucar\b/, 200],
  [/\b(?:cacao|cocoa)\b/, 90],
  [/\b(?:pan rallado|panko)\b/, 100],
  [/\b(?:almendras?|nuez|nueces|mani|maranon(?:es)?|pistachos?|avellanas?)\b/, 140],
  [/\b(?:pasta|rigatoni|espagueti|macarron(?:es)?|fideos)\b(?! de (?:tomate|mani|ajo|aji))/, 100],
  [/\b(?:espinaca|lechuga|rucula|kale|albahaca|cilantro|perejil)\b/, 30],
  [/\bqueso\b/, 110],
];

/** Equivalencias del ingrediente, completadas con las aproximadas de taza, cucharada y cucharadita. */
export function gramsPerMeasure(i: Measurable): Partial<Record<Unit, number>> {
  if (isLiquid(i)) return i.gramsPerUnit;
  const cup = i.gramsPerUnit.cup ?? CUP_GRAMS.find(([re]) => re.test(i.searchText.normalize('NFD').replace(/\p{Diacritic}/gu, '')))?.[1];
  if (cup === undefined) return i.gramsPerUnit;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { cup, tbsp: round(cup / 16), tsp: round(cup / 48), ...i.gramsPerUnit };
}
