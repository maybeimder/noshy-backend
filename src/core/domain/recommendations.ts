import type { MealSlotId } from './catalog.js';

/** Puntaje de recomendación. Determinista y explicable; un modelo puede reemplazarlo detrás del mismo servicio. */
export type Candidate = {
  recipeId: string;
  mealSlots: MealSlotId[];
  timeMax: number;
  cuisineId: string | null;
  flavorTags: string[];
  dishId: string | null;
  pantry: { have: number; total: number };
  usesIngredientIds: string[];
  timesCookedLast14d: number;
  compatible: boolean;
};

export type UserTaste = {
  maxCookingMinutes: number | null;
  favoriteDishIds: string[];
  lovedFlavors: string[];
  likedCuisineIds: string[];
  dislikedRecipeIds: string[];
};

export type ScoreInput = { slot?: MealSlotId; source: 'forYou' | 'pantry'; usingIngredientIds: string[]; maxMinutes?: number };

export function score(c: Candidate, taste: UserTaste, input: ScoreInput): number | null {
  if (!c.compatible) return null;
  if (taste.dislikedRecipeIds.includes(c.recipeId)) return null;
  const maxMin = input.maxMinutes ?? taste.maxCookingMinutes ?? null;
  if (maxMin !== null && c.timeMax > maxMin + 10) return null;
  if (input.usingIngredientIds.length && !input.usingIngredientIds.some((i) => c.usesIngredientIds.includes(i))) return null;

  const pantryRatio = c.pantry.total ? c.pantry.have / c.pantry.total : 0;
  let s = pantryRatio * (input.source === 'pantry' ? 5 : 2);
  if (input.slot && c.mealSlots.includes(input.slot)) s += 2;
  else if (input.slot) s -= 1.5;
  if (c.dishId && taste.favoriteDishIds.includes(c.dishId)) s += 1.5;
  if (c.cuisineId && taste.likedCuisineIds.includes(c.cuisineId)) s += 0.8;
  s += c.flavorTags.filter((t) => taste.lovedFlavors.includes(t)).length * 0.5;
  if (maxMin !== null && c.timeMax <= maxMin) s += 0.5;
  s -= c.timesCookedLast14d * 0.7;
  if (input.usingIngredientIds.length) s += 2;
  return Math.round(s * 100) / 100;
}

export function pantryReasonLabel(have: number, total: number): string {
  return `${have}/${total} en tu despensa`;
}
