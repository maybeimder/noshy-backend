import { describe, expect, it } from 'vitest';
import { kcalFit, score, type Candidate, type UserTaste } from '../../src/core/domain/recommendations.js';
import { tasteFromSignals } from '../../src/modules/recipes/recommendations.service.js';
import type { UserSignalDoc } from '../../src/infrastructure/database/mongo/collections.js';

const c: Candidate = { recipeId: 'r', mealSlots: ['lunch'], timeMax: 20, cuisineId: null, flavorTags: ['creamy'], dishId: null, pantry: { have: 0, total: 4 }, usesIngredientIds: [], timesCookedLast14d: 0, compatible: true, kcal: 700 };
const taste: UserTaste = { maxCookingMinutes: 30, favoriteDishIds: [], lovedFlavors: [], likedCuisineIds: [], dislikedRecipeIds: [], likedRecipeIds: [], learnedFlavors: [], kcalTarget: 2000 };
const input = { source: 'forYou' as const, usingIngredientIds: [], slot: 'lunch' as const };
const sig = (kind: UserSignalDoc['kind'], day: number, o: Partial<UserSignalDoc>): UserSignalDoc => ({ userId: 'u', kind, at: new Date(2026, 10, day), eventId: `${kind}${day}`, ...o });

describe('recomendaciones', () => {
  it('sin macros no se recomienda; las calorías de la comida pesan', () => {
    expect(score({ ...c, kcal: 0 }, taste, input)).toBeNull();
    expect(kcalFit(700, 2000, 'lunch')).toBe(1);
    expect(kcalFit(1400, 2000, 'lunch')).toBe(-1);
    expect(score(c, taste, input)!).toBeGreaterThan(score({ ...c, kcal: 1300 }, taste, input)!);
  });

  it('👎 la saca; me gusta y lo que cocina la suben', () => {
    expect(score(c, { ...taste, dislikedRecipeIds: ['r'] }, input)).toBeNull();
    const base = score(c, taste, input)!;
    expect(score(c, { ...taste, likedRecipeIds: ['r'] }, input)!).toBeGreaterThan(base);
    expect(score(c, { ...taste, learnedFlavors: ['creamy'] }, input)!).toBeGreaterThan(base);
  });

  it('manda la opinión más reciente, venga en el orden que venga', () => {
    const t = tasteFromSignals([
      sig('ideaFeedback', 5, { recipeId: 'a', value: 1 }),
      sig('ideaFeedback', 2, { recipeId: 'a', value: -1 }),
      sig('liked', 3, { recipeId: 'b', value: 1 }),
      sig('liked', 4, { recipeId: 'b', value: -1 }),
      sig('rated', 4, { recipeId: 'c', value: 1 }),
      sig('rated', 4, { recipeId: 'd', value: 5 }),
      ...[1, 2, 3].map((d) => sig('cooked', d, { recipeId: 'e', tags: ['spicy'] })),
    ]);
    expect(t).toEqual({ disliked: ['c'], liked: ['a', 'd'], learnedFlavors: ['spicy'] });
  });
});
