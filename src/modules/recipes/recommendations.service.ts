import { matchesText } from '../../core/shared/text-search.js';
import type { RecipesRepository } from './recipes.repository.js';
import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { UserSignalDoc } from '../../infrastructure/database/mongo/collections.js';
import { EXPLORE_TARGET, type RecipeLibraryService } from './library.service.js';
import type { ChefRepository } from '../chef/chef.repository.js';
import type { CookingRepository } from '../cooking/cooking.repository.js';
import type { RecipesService, UserContext, Evaluated } from './recipes.service.js';
import { score, pantryReasonLabel, type Candidate, type UserTaste } from '../../core/domain/recommendations.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import { decodeCursor, encodeCursor } from '../../core/shared/cursor.js';

export type RecommendInput = {
  slot?: MealSlotId;
  /** `library`: solo el recetario (recetas de la biblioteca). */
  source?: 'forYou' | 'pantry' | 'library';
  usingIngredientIds?: string[];
  /** Palabras del título, la cocina, las etiquetas o los ingredientes. */
  q?: string;
  maxMinutes?: number;
  excludeRecipeIds?: string[];
  limit?: number;
  cursor?: string;
  /** Recetario completo: no filtra por el tiempo que la persona prefiere para cocinar. */
  anyTime?: boolean;
};

/** Un 👎 deja de pesar a los dos meses: los gustos cambian y el catálogo no es infinito. */
const SIGNALS_DAYS = 60;
const LEARNED_FLAVOR_MIN = 3;

/** Lo que dicen las señales del usuario. La opinión más reciente sobre una receta manda. */
export function tasteFromSignals(signals: UserSignalDoc[]) {
  const opinion = new Map<string, number>();
  const flavors = new Map<string, number>();
  for (const s of [...signals].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (s.kind === 'cooked') for (const t of s.tags ?? []) flavors.set(t, (flavors.get(t) ?? 0) + 1);
    if (!s.recipeId || s.value === undefined) continue;
    if (s.kind === 'ideaFeedback') opinion.set(s.recipeId, s.value);
    // Quitar un «me gusta» no es rechazarla: vuelve a neutro.
    else if (s.kind === 'liked') opinion.set(s.recipeId, Math.max(0, s.value));
    else if (s.kind === 'rated') opinion.set(s.recipeId, s.value >= 4 ? 1 : s.value <= 2 ? -1 : 0);
  }
  const having = (sign: number) => [...opinion].filter(([, v]) => v === sign).map(([id]) => id);
  return { disliked: having(-1), liked: having(1), learnedFlavors: [...flavors].filter(([, n]) => n >= LEARNED_FLAVOR_MIN).map(([t]) => t) };
}

/**
 * Ideas de recetas. Una sola fuente para «Hoy para ti», el banner de la despensa,
 * los avisos de vencimiento, el menú semanal y las ideas del chef.
 */
export class RecommendationsService {
  constructor(
    private readonly recipesRepo: RecipesRepository,
    private readonly recipes: RecipesService,
    private readonly cooking: CookingRepository,
    private readonly chef: ChefRepository,
    private readonly log: FastifyBaseLogger,
    private readonly library: RecipeLibraryService,
  ) {}

  private async taste(ctx: UserContext): Promise<UserTaste> {
    const signals = await this.chef.signals(ctx.userId, new Date(Date.now() - SIGNALS_DAYS * 86_400_000)).catch((err: unknown) => {
      this.log.warn({ err }, 'sin señales del usuario: recomiendo solo con sus preferencias');
      return [];
    });
    const learned = tasteFromSignals(signals);
    return {
      maxCookingMinutes: ctx.prefs.kitchen.maxCookingMinutes,
      favoriteDishIds: ctx.prefs.favoriteDishIds,
      lovedFlavors: ctx.prefs.loves.map((l) => l.id),
      likedCuisineIds: ctx.prefs.likedCuisines.map((c) => c.id),
      dislikedRecipeIds: learned.disliked,
      likedRecipeIds: learned.liked,
      learnedFlavors: learned.learnedFlavors,
      kcalTarget: ctx.prefs.nutritionTargets.kcal,
    };
  }

  async ranked(userId: string, input: RecommendInput, ctx?: UserContext) {
    const c = ctx ?? (await this.recipes.context(userId));
    const [taste, published, recent] = await Promise.all([this.taste(c), this.recipesRepo.published({ raw: input.anyTime }), this.cooking.countsSince(userId, new Date(Date.now() - 14 * 86_400_000))]);
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
        kcal: e.nutritionPerServing.kcal,
      };
      const s = score(cand, input.anyTime ? { ...taste, maxCookingMinutes: null } : taste, { slot: input.slot, source: input.source === 'pantry' ? 'pantry' : 'forYou', usingIngredientIds: using, maxMinutes: input.maxMinutes });
      if (s !== null) scored.push({ e, s });
    }
    // Los empates rotan por persona y día: con muchas recetas parecidas, por id saldrían siempre las mismas.
    const day = new Date().toISOString().slice(0, 10);
    const order = (id: string) => createHash('sha1').update(`${userId}|${day}|${id}`).digest('hex');
    return scored.map((x) => ({ ...x, o: order(x.e.recipe.id) })).sort((a, b) => b.s - a.s || a.o.localeCompare(b.o));
  }

  reasonFor(e: Evaluated, input: RecommendInput) {
    const { have, total } = e.pantryMatch;
    if (input.usingIngredientIds?.length) {
      const used = e.ingredients.find((i) => input.usingIngredientIds!.includes(i.ingredientId));
      return { kind: 'expiring' as const, label: `Usa tu ${used?.label.toLowerCase() ?? 'ingrediente'}` };
    }
    if (input.source === 'pantry' || (total > 0 && have / total >= 0.6)) return { kind: 'pantry' as const, label: pantryReasonLabel(have, total) };
    if (input.anyTime && e.recipe.authorType === 'user') return { kind: 'forYou' as const, label: 'De la comunidad' };
    if (input.anyTime && e.recipe.nutritionStatus === 'estimated') return { kind: 'forYou' as const, label: 'Biblioteca' };
    return { kind: 'forYou' as const, label: 'Para ti' };
  }

  async recommend(userId: string, input: RecommendInput) {
    const limit = Math.min(input.limit ?? 3, 20);
    const offset = Number(decodeCursor(input.cursor)?.k ?? 0);
    const explored = this.isExplore(input) ? await this.explore(userId, input) : null;
    const found = explored?.ranked ?? (await this.ranked(userId, input));
    const ranked = input.q ? found.filter(({ e }) => matchesText(input.q, e.recipe.title, e.recipe.cuisineLabel, ...e.recipe.tags, ...e.ingredients.map((i) => i.label))) : found;
    const pageRows = ranked.slice(offset, offset + limit);
    const flags = await this.recipesRepo.viewerFlags(userId, pageRows.map((r) => r.e.recipe.id));
    const data = pageRows.map(({ e }) => ({ ...this.recipes.card(e, flags.saved.has(e.recipe.id)), reason: this.reasonFor(e, explored ? { ...input, anyTime: true } : input) }));
    const nextCursor = offset + limit < ranked.length ? encodeCursor({ k: offset + limit, id: 'offset' }) : null;
    return { data, meta: { nextCursor, limit, ...(explored ? { total: ranked.length, library: explored.library } : {}) } };
  }

  /** «Explorar» pide sin comida, despensa ni ingrediente: ahí va el recetario completo. */
  private isExplore(input: RecommendInput) {
    return !input.slot && input.source !== 'pantry' && !input.usingIngredientIds?.length;
  }

  /**
   * Recetario, comunidad y Noshy, intercaladas para que ninguna tape a las otras; cada una en su orden de afinidad.
   * `library` dice cuántas del recetario puede ver y si se están trayendo más.
   */
  private async explore(userId: string, input: RecommendInput) {
    const ctx = await this.recipes.context(userId);
    let all = await this.ranked(userId, { ...input, maxMinutes: undefined, anyTime: true }, ctx);
    const origin = (e: Evaluated) => (e.recipe.nutritionStatus === 'estimated' ? 0 : e.recipe.authorType === 'user' ? 1 : 2);
    const count = () => all.filter((r) => origin(r.e) === 0).length;
    const before = count();
    const status = await this.library.fillForExplore(before, this.recipes.avoidFor(ctx.prefs));
    // Lo que se acaba de traer sale en esta misma respuesta.
    if (before < EXPLORE_TARGET && status !== 'paused') all = await this.ranked(userId, { ...input, maxMinutes: undefined, anyTime: true }, ctx);
    const library = { count: count(), status };
    const fits = input.maxMinutes === undefined ? all : await this.ranked(userId, { ...input, anyTime: true }, ctx);
    const seen = [0, 0, 0];
    const ranked = fits
      .filter((r) => input.source !== 'library' || origin(r.e) === 0)
      .map((r) => ({ r, turn: seen[origin(r.e)]!++, o: origin(r.e) }))
      .sort((a, b) => a.turn - b.turn || a.o - b.o)
      .map((x) => x.r);
    return { ranked, library };
  }

  /** Recetas que se pueden cocinar esta semana con lo que hay (≥ 60 % de ingredientes principales). */
  async possibleWithPantry(userId: string) {
    const ranked = await this.ranked(userId, { source: 'pantry' });
    const possible = ranked.filter(({ e }) => e.pantryMatch.total > 0 && e.pantryMatch.have / e.pantryMatch.total >= 0.6);
    return { count: possible.length, previewImageUrls: possible.slice(0, 2).map(({ e }) => e.recipe.imageUrl).filter((u): u is string => !!u) };
  }
}
