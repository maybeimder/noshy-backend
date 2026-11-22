import type { ActivityLevel, GoalId } from './catalog.js';
import { toGrams, type Unit } from './quantity.js';

export type Macros = { kcal: number; proteinG: number; carbsG: number; fatG: number };
export type MacrosWithFiber = Macros & { fiberG: number };
export type Biometrics = { weightKg: number; heightCm: number; birthYear: number; sex: 'female' | 'male' | null };

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = { sedentary: 1.35, active: 1.55, veryActive: 1.75 };

/** Referencia poblacional cuando no hay biometría (adulto promedio, en reposo). */
const POPULATION_BMR = 1420;

/** Reparto de macros (porcentaje de kcal) según el objetivo principal. */
function macroSplitFor(goalIds: GoalId[]) {
  if (goalIds.includes('gainMuscle')) return { proteinPct: 30, carbsPct: 42, fatPct: 28 };
  if (goalIds.includes('loseWeight')) return { proteinPct: 28, carbsPct: 40, fatPct: 32 };
  return { proteinPct: 22, carbsPct: 44, fatPct: 29 };
}

function goalAdjustment(goalIds: GoalId[]): number {
  if (goalIds.includes('loseWeight')) return -0.15;
  if (goalIds.includes('gainMuscle')) return 0.1;
  return 0;
}

export const KCAL_STEP = 50;
export const KCAL_RANGE = { min: 1400, max: 4000 };

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function bmrFrom(b: Biometrics, now = new Date()): number {
  const age = now.getUTCFullYear() - b.birthYear;
  const base = 10 * b.weightKg + 6.25 * b.heightCm - 5 * age; // Mifflin-St Jeor
  if (b.sex === 'male') return base + 5;
  if (b.sex === 'female') return base - 161;
  return base - 78; // punto medio cuando el usuario no lo indica
}

export type NutritionPreview = {
  kcal: number;
  range: { min: number; max: number; step: number };
  macros: { proteinG: number; carbsG: number; fatG: number; fiberG: number };
  macroSplit: { proteinPct: number; carbsPct: number; fatPct: number };
  fiberGPer1000Kcal: number;
  basis: 'populationDefault' | 'biometrics';
};

export const FIBER_PER_1000_KCAL = 14;

export function macrosForKcal(kcal: number, split: NutritionPreview['macroSplit']) {
  return {
    proteinG: Math.round((kcal * split.proteinPct) / 100 / 4),
    carbsG: Math.round((kcal * split.carbsPct) / 100 / 4),
    fatG: Math.round((kcal * split.fatPct) / 100 / 9),
    fiberG: Math.round((kcal / 1000) * FIBER_PER_1000_KCAL),
  };
}

/** Punto de partida del Paso 2. Es la única fuente de la fórmula: el generador de menús usa la misma. */
export function computeTargets(input: { goalIds: GoalId[]; activityLevel: ActivityLevel; biometrics?: Biometrics | null }): NutritionPreview {
  const bmr = input.biometrics ? bmrFrom(input.biometrics) : POPULATION_BMR;
  const raw = bmr * ACTIVITY_FACTOR[input.activityLevel] * (1 + goalAdjustment(input.goalIds));
  const kcal = clamp(roundTo(raw, KCAL_STEP), KCAL_RANGE.min, KCAL_RANGE.max);
  const macroSplit = macroSplitFor(input.goalIds);
  return {
    kcal,
    range: { ...KCAL_RANGE, step: KCAL_STEP },
    macros: macrosForKcal(kcal, macroSplit),
    macroSplit,
    fiberGPer1000Kcal: FIBER_PER_1000_KCAL,
    basis: input.biometrics ? 'biometrics' : 'populationDefault',
  };
}

export function isValidKcalTarget(kcal: number): boolean {
  return kcal >= KCAL_RANGE.min && kcal <= KCAL_RANGE.max && kcal % KCAL_STEP === 0;
}

export type IngredientNutrition = {
  per100g: MacrosWithFiber | null;
  gramsPerUnit: Partial<Record<Unit, number>>;
};

/**
 * Suma la nutrición de una lista de ingredientes y la divide por porciones.
 * `status` es `partial` cuando algún ingrediente no se pudo convertir o no tiene datos.
 */
export function recipeNutrition(
  items: { value: number | null; unit: Unit; nutrition: IngredientNutrition }[],
  servings: number,
): { perServing: Macros; status: 'calculated' | 'partial' | 'empty' } {
  if (items.length === 0) return { perServing: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, status: 'empty' };
  let partial = false;
  const total = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const it of items) {
    if (it.unit === 'toTaste' || it.unit === 'all') continue;
    const grams = toGrams(it.value, it.unit, it.nutrition.gramsPerUnit);
    if (grams === null || !it.nutrition.per100g) {
      partial = true;
      continue;
    }
    const f = grams / 100;
    total.kcal += it.nutrition.per100g.kcal * f;
    total.proteinG += it.nutrition.per100g.proteinG * f;
    total.carbsG += it.nutrition.per100g.carbsG * f;
    total.fatG += it.nutrition.per100g.fatG * f;
  }
  const s = Math.max(1, servings);
  return {
    perServing: {
      kcal: Math.round(total.kcal / s),
      proteinG: Math.round(total.proteinG / s),
      carbsG: Math.round(total.carbsG / s),
      fatG: Math.round(total.fatG / s),
    },
    status: partial ? 'partial' : 'calculated',
  };
}

export const scaleMacros = (m: Macros, factor: number): Macros => ({
  kcal: Math.round(m.kcal * factor),
  proteinG: Math.round(m.proteinG * factor),
  carbsG: Math.round(m.carbsG * factor),
  fatG: Math.round(m.fatG * factor),
});

export const sumMacros = (list: Macros[]): Macros =>
  list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, proteinG: a.proteinG + m.proteinG, carbsG: a.carbsG + m.carbsG, fatG: a.fatG + m.fatG }), {
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  });
