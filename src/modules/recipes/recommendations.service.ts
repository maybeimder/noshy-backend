import type { RecipesRepository } from './recipes.repository.js';
import type { CookingRepository } from '../cooking/cooking.repository.js';
import type { RecipesService, UserContext, Evaluated } from './recipes.service.js';
import { score, pantryReasonLabel, type Candidate, type UserTaste } from '../../core/domain/recommendations.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import { decodeCursor, encodeCursor } from '../../core/shared/cursor.js';
import type { CatalogService } from '../catalog/catalog.service.js';

export type RecommendInput = {
  slot?: MealSlotId;
  source?: 'forYou' | 'pantry';
  usingIngredientIds?: string[];
  maxMinutes?: number;
  excludeRecipeIds?: string[];
  limit?: number;
  cursor?: string;
};

/**
 * Ideas de recetas. Una sola fuente para «Hoy para ti», el banner de la despensa,
 * los avisos de vencimiento, el menú semanal y las ideas del chef.
 */
export class RecommendationsService {
  constructor(
    private readonly recipesRepo: RecipesRepository,
    private readonly recipes: RecipesService,
    private readonly cooking: CookingRepository,
    private readonly catalog: CatalogService,
  ) {}

  private taste(ctx: UserContext, disliked: string[]): UserTaste {
    return {
      maxCookingMinutes: ctx.prefs.kitchen.maxCookingMinutes,
      favoriteDishIds: ctx.prefs.favoriteDishIds,
      lovedFlavors: ctx.prefs.loves.map((l) => l.id),
      likedCuisineIds: ctx.prefs.likedCuisines.map((c) => c.id),
      dislikedRecipeIds: disliked,
    };
  }

  async ranked(userId: string, input: RecommendInput, ctx?: UserContext) {
    const c = ctx ?? (await this.recipes.context(userId));
    const [published, recent] = await Promise.all([this.recipesRepo.published(), this.cooking.countsSince(userId, new Date(Date.now() - 14 * 86_400_000))]);
    const evaluated = await this.recipes.evaluateMany(published, c);
    const using = input.usingIngredientIds ?? [];
    const exclude = new Set(input.excludeRecipeIds ?? []);
    const scored: { e: Evaluated; s: number }[] = [];
    for (const e of evaluated) {
      if (exclude.has(e.recipe.id)) continue;
      const cand: Candidate = {
        recipeId: e.recipe.id,
        mealSlots: e.recipe.mealSlots as MealSlotId[],
        timeMax: e.recipe.timeMax ?? 0,
        cuisineId: e.recipe.cuisineId,
        flavorTags: e.recipe.flavorTags,
        dishId: e.recipe.dishId,
        pantry: e.pantryMatch,
        usesIngredientIds: e.ingredients.map((i) => i.ingredientId),
        timesCookedLast14d: recent.get(e.recipe.id) ?? 0,
        compatible: e.evaluation.compatibility.ok,
      };
      const s = score(cand, this.taste(c, []), { slot: input.slot, source: input.source ?? 'forYou', usingIngredientIds: using, maxMinutes: input.maxMinutes });
      if (s !== null) scored.push({ e, s });
    }
    return scored.sort((a, b) => b.s - a.s || a.e.recipe.id.localeCompare(b.e.recipe.id));
  }

  reasonFor(e: Evaluated, input: RecommendInput) {
    const { have, total } = e.pantryMatch;
    if (input.usingIngredientIds?.length) {
      const used = e.ingredients.find((i) => input.usingIngredientIds!.includes(i.ingredientId));
      return { kind: 'expiring' as const, label: `Usa tu ${used?.label.toLowerCase() ?? 'ingrediente'}` };
    }
    if (input.source === 'pantry' || (total > 0 && have / total >= 0.6)) return { kind: 'pantry' as const, label: pantryReasonLabel(have, total) };
    return { kind: 'forYou' as const, label: 'Para ti' };
  }

  async recommend(userId: string, input: RecommendInput) {
    const limit = Math.min(input.limit ?? 3, 20);
    const offset = Number(decodeCursor(input.cursor)?.k ?? 0);
    const ranked = await this.ranked(userId, input);
    const pageRows = ranked.slice(offset, offset + limit);
    const flags = await this.recipesRepo.viewerFlags(userId, pageRows.map((r) => r.e.recipe.id));
    const data = pageRows.map(({ e }) => ({ ...this.recipes.card(e, flags.saved.has(e.recipe.id)), reason: this.reasonFor(e, input) }));
    const nextCursor = offset + limit < ranked.length ? encodeCursor({ k: offset + limit, id: 'offset' }) : null;
    return { data, meta: { nextCursor, limit } };
  }

  /** Recetas que se pueden cocinar esta semana con lo que hay (≥ 60 % de ingredientes principales). */
  async possibleWithPantry(userId: string) {
    const ranked = await this.ranked(userId, { source: 'pantry' });
    const possible = ranked.filter(({ e }) => e.pantryMatch.total > 0 && e.pantryMatch.have / e.pantryMatch.total >= 0.6);
    return { count: possible.length, previewImageUrls: possible.slice(0, 2).map(({ e }) => e.recipe.imageUrl).filter((u): u is string => !!u) };
  }
}
