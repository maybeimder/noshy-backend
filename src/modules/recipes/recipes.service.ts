import { createHash } from 'node:crypto';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { RecipesRepository, RecipeRow, RecipeIngredientRow, AdaptationRow } from './recipes.repository.js';
import type { PantryRepository } from '../pantry/pantry.repository.js';
import type { ShoppingRepository } from '../shopping/shopping.repository.js';
import type { ChefRepository } from '../chef/chef.repository.js';
import type { PreferencesRow } from '../onboarding/preferences.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import { evaluateRecipe, type RecipeEvaluation, type Labeled } from '../../core/domain/restrictions.js';
import { recipeNutrition, type Macros } from '../../core/domain/nutrition.js';
import { assignStepIngredients } from '../../core/domain/step-ingredients.js';
import { heatLabel, type Quantity, type Unit } from '../../core/domain/quantity.js';
import { DIFFICULTIES, labelOf, type GoalId } from '../../core/domain/catalog.js';
import type { CookingStepSnapshot } from '../cooking/cooking.snapshots.js';
import type { StepTemplate } from '../../infrastructure/database/postgres/types.js';
import { isDishPhoto } from './dish-photos.js';
import { Errors } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

export type UserContext = {
  userId: string;
  prefs: PreferencesRow;
  goals: GoalId[];
  pantry: Set<string>;
};

export type ResolvedIngredient = {
  ingredientId: string;
  originalIngredientId: string;
  label: string;
  icon: string;
  value: number | null;
  unit: Unit;
  prep: string | null;
  isSubstitute: boolean;
  isBasic: boolean;
};

export type Evaluated = {
  recipe: RecipeRow;
  evaluation: RecipeEvaluation;
  ingredients: ResolvedIngredient[];
  nutritionPerServing: Macros;
  pantryMatch: { have: number; total: number };
};

export type RecipeCard = {
  id: string;
  title: string;
  imageUrl: string | null;
  cuisine: { id: string; label: string } | null;
  tags: string[];
  totalTimeMinutes: { min: number; max: number };
  nutritionPerServing: Macros;
  pantryMatch: { have: number; total: number };
  isAdapted: boolean;
  isSaved: boolean;
  /** Macros estimados por un modelo, no sumados desde el catálogo. */
  nutritionEstimated: boolean;
  /** La foto es de un plato parecido, no de esta receta. */
  imageIsReference: boolean;
};

const hashOf = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

/**
 * Recetas personalizadas: compatibilidad con restricciones, sustituciones automáticas,
 * macros de la versión adaptada, coincidencia con la despensa y estructura para modo cocina.
 */
export class RecipesService {
  constructor(
    private readonly db: Db,
    private readonly repo: RecipesRepository,
    private readonly pantry: PantryRepository,
    private readonly shopping: ShoppingRepository,
    private readonly chef: ChefRepository,
    private readonly catalog: CatalogService,
    private readonly preferences: PreferencesService,
    private readonly users: UsersRepository,
    private readonly outbox: Outbox,
    private readonly shareBaseUrl: string,
  ) {}

  async context(userId: string): Promise<UserContext> {
    const [prefs, pantry] = await Promise.all([this.preferences.getOrThrow(userId), this.pantry.availableIngredientIds(userId)]);
    return { userId, prefs, goals: this.preferences.goalsOf(prefs), pantry };
  }

  /** Aplica restricciones y metas a una receta sin escribir nada. */
  evaluate(recipe: RecipeRow, rows: RecipeIngredientRow[], ctx: UserContext, adapted = true): Evaluated {
    const facts = rows.map((r) => this.catalog.facts(r.ingredientId));
    const evaluation = adapted
      ? evaluateRecipe(facts, this.preferences.restrictionsOf(ctx.prefs), this.catalog.substituteRules(), ctx.goals)
      : { ...evaluateRecipe(facts, this.preferences.restrictionsOf(ctx.prefs), [], []), substitutions: [], reasons: [] };
    const swap = new Map(evaluation.substitutions.map((s) => [s.from.ingredientId, s.to.ingredientId]));
    const ingredients: ResolvedIngredient[] = rows.map((r) => {
      const id = swap.get(r.ingredientId) ?? r.ingredientId;
      const ing = this.catalog.ingredientOrThrow(id);
      const unit = ing.allowedUnits.includes(r.unit) ? r.unit : r.unit;
      return {
        ingredientId: id,
        originalIngredientId: r.ingredientId,
        label: ing.label,
        icon: ing.icon,
        value: r.value,
        unit,
        prep: r.prep,
        isSubstitute: id !== r.ingredientId,
        isBasic: ing.isBasic,
      };
    });
    const nutrition = recipeNutrition(
      ingredients.map((i) => ({ value: i.value, unit: i.unit, nutrition: this.catalog.nutrition(i.ingredientId) })),
      recipe.baseServings,
    );
    const main = ingredients.filter((i) => !i.isBasic);
    return {
      recipe,
      evaluation,
      ingredients,
      nutritionPerServing: nutrition.status === 'empty' || recipe.nutritionStatus === 'estimated' ? (recipe.nutritionPerServing ?? nutrition.perServing) : nutrition.perServing,
      pantryMatch: { have: main.filter((i) => ctx.pantry.has(i.ingredientId)).length, total: main.length },
    };
  }

  /** Con los ingredientes listos en memoria: el worker pudo crear recetas que este proceso aún no conoce. */
  private async ingredientsFor(recipeIds: string[]) {
    const rows = await this.repo.ingredientsFor(recipeIds);
    await this.catalog.ensure([...rows.values()].flat().map((r) => r.ingredientId));
    return rows;
  }

  /** Receta en texto, adaptada a la persona, para que el chef responda dudas sobre ella. */
  async brief(userId: string, recipeId: string): Promise<string> {
    const recipe = await this.getVisible(userId, recipeId);
    const rows = (await this.ingredientsFor([recipe.id])).get(recipe.id) ?? [];
    const e = this.evaluate(recipe, rows, await this.context(userId));
    const n = e.nutritionPerServing;
    return [
      `${recipe.title} · ${recipe.baseServings} porciones · ${recipe.timeMax ?? recipe.timeMin ?? '?'} min`,
      `Por porción: ${n.kcal} kcal, ${n.proteinG} g proteína, ${n.carbsG} g carbohidratos, ${n.fatG} g grasa`,
      `Ingredientes: ${e.ingredients.map((i) => `${this.catalog.quantity(i.ingredientId, i.value, i.unit).display} ${i.label}`).join('; ')}`,
      `Pasos: ${this.cookingSteps(recipe, rows, null, 1).map((s, i) => `${i + 1}. ${s.subSteps.map((x) => x.text).join(' ')}`).join(' ')}`,
    ].join('\n');
  }

  async evaluateMany(recipes: RecipeRow[], ctx: UserContext): Promise<Evaluated[]> {
    const ingredients = await this.ingredientsFor(recipes.map((r) => r.id));
    return recipes.map((r) => this.evaluate(r, ingredients.get(r.id) ?? [], ctx));
  }

  card(e: Evaluated, saved: boolean): RecipeCard {
    const r = e.recipe;
    return {
      id: r.id,
      title: r.title,
      imageUrl: r.imageUrl,
      cuisine: r.cuisineId ? { id: r.cuisineId, label: r.cuisineLabel ?? r.cuisineId } : null,
      tags: r.tags,
      totalTimeMinutes: { min: r.timeMin ?? 0, max: r.timeMax ?? r.timeMin ?? 0 },
      nutritionPerServing: e.nutritionPerServing,
      pantryMatch: e.pantryMatch,
      isAdapted: e.evaluation.substitutions.length > 0,
      isSaved: saved,
      nutritionEstimated: r.nutritionStatus === 'estimated',
      imageIsReference: isDishPhoto(r.imageUrl),
    };
  }

  /** Para descartar, antes de gastar nada, lo que choca con la persona. */
  avoidFor(prefs: PreferencesRow) {
    return (f: { allergens: string[]; dietFlags: string[] }) => this.preferences.conflictsForFacts(prefs, { id: '', label: '', ...f }).length > 0;
  }

  /** Tarjetas en el mismo orden de `recipeIds`. */
  async cards(userId: string, recipeIds: string[], ctx?: UserContext): Promise<RecipeCard[]> {
    const c = ctx ?? (await this.context(userId));
    const recipes = await this.repo.byIds(recipeIds);
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const ordered = recipeIds.map((id) => byId.get(id)).filter((r): r is RecipeRow => !!r);
    const [evaluated, flags] = await Promise.all([this.evaluateMany(ordered, c), this.repo.viewerFlags(userId, recipeIds)]);
    return evaluated.map((e) => this.card(e, flags.saved.has(e.recipe.id)));
  }

  async getVisible(userId: string, recipeId: string): Promise<RecipeRow> {
    const recipe = await this.repo.byId(recipeId);
    if (!recipe) throw Errors.notFound('Esa receta no existe.');
    if (recipe.status === 'removed') throw Errors.gone('RECIPE_REMOVED', 'Esta receta ya no está disponible.');
    if (recipe.status !== 'published' && recipe.authorId !== userId) {
      if (recipe.authorType === 'user' && recipe.status === 'rejected') throw Errors.gone('RECIPE_REMOVED', 'Esta receta ya no está disponible.');
      throw Errors.notFound('Esa receta no existe.');
    }
    return recipe;
  }

  /**
   * Devuelve la adaptación vigente con ID estable. Si cambian las preferencias, crea una nueva
   * y conserva las notas de una propuesta aplicada (por ejemplo «en airfryer»).
   */
  async ensureAdaptation(ctx: UserContext, e: Evaluated, exec: Executor = this.db): Promise<AdaptationRow | null> {
    const active = await this.repo.activeAdaptation(ctx.userId, e.recipe.id);
    const subs = e.evaluation.substitutions;
    const hash = hashOf({ subs: subs.map((s) => [s.from.ingredientId, s.to.ingredientId, s.reason]) });
    if (active && active.preferencesHash === hash) return active;
    if (subs.length === 0 && (!active || active.source === 'auto')) return null;
    const proposalReasons = active?.source === 'proposal' ? active.reasons.filter((r) => !e.evaluation.reasons.some((x) => x.id === r.id)) : [];
    const row = await this.repo.activateAdaptation(exec, {
      id: newId('adaptation'),
      userId: ctx.userId,
      recipeId: e.recipe.id,
      reasons: [...e.evaluation.reasons, ...proposalReasons],
      substitutions: subs,
      stepNotes: active?.source === 'proposal' ? active.stepNotes : [],
      source: active?.source === 'proposal' ? 'proposal' : 'auto',
      preferencesHash: hash,
    });
    await this.outbox.record(exec, 'recipe.adapted', { userId: ctx.userId, recipeId: e.recipe.id, adaptationId: row.id, source: 'auto' });
    return row;
  }

  scaleIngredient(i: ResolvedIngredient, factor: number): { quantity: Quantity; value: number | null } {
    const value = i.value === null ? null : i.value * factor;
    return { value, quantity: this.catalog.quantity(i.ingredientId, value, i.unit) };
  }

  async detail(userId: string, recipeId: string, opts: { servings?: number; adapted: boolean }) {
    const recipe = await this.getVisible(userId, recipeId);
    const ctx = await this.context(userId);
    const rows = (await this.ingredientsFor([recipe.id])).get(recipe.id) ?? [];
    const e = this.evaluate(recipe, rows, ctx, opts.adapted);
    const adaptation = opts.adapted ? await this.ensureAdaptation(ctx, e) : null;
    this.outbox.kick();
    const servingsValue = opts.servings ?? recipe.baseServings;
    const factor = servingsValue / recipe.baseServings;
    const [flags, threadId, listIds] = await Promise.all([
      this.repo.viewerFlags(userId, [recipe.id]),
      this.chef.threadIdForRecipe(userId, recipe.id),
      this.shopping.activeIngredientIds(userId),
    ]);
    const author =
      recipe.authorType === 'user' && recipe.authorId
        ? await this.authorOf(recipe.authorId)
        : { type: recipe.authorType, id: null, displayName: recipe.authorType === 'chef' ? 'Tu chef' : 'Noshy' };
    return {
      ...this.card(e, flags.saved.has(recipe.id)),
      author,
      rating: recipe.ratingCount > 0 ? { avg: Math.round((recipe.ratingSum / recipe.ratingCount) * 10) / 10, count: recipe.ratingCount } : null,
      servings: { value: servingsValue, min: 1, max: 8 },
      difficulty: recipe.difficulty ? { id: recipe.difficulty, label: labelOf(DIFFICULTIES, recipe.difficulty) } : null,
      stepsCount: recipe.steps.length || recipe.userSteps.length,
      steps: this.cookingSteps(recipe, rows, adaptation, factor).map((st) => ({
        title: st.title,
        text: st.subSteps.map((ss) => ss.text).join(' '),
        timerSeconds: st.subSteps.reduce((a, ss) => a + (ss.timerSeconds ?? 0), 0) || null,
        heatLevel: st.heat.level,
        ingredients: st.ingredients.map((i) => ({ ...i, inPantry: i.ingredientId ? ctx.pantry.has(i.ingredientId) : true })),
      })),
      adaptation: adaptation
        ? { id: adaptation.id, reasons: adaptation.reasons, substitutions: adaptation.substitutions, stepNotes: adaptation.stepNotes }
        : null,
      ingredients: e.ingredients.map((i) => ({
        ingredientId: i.ingredientId,
        label: i.label,
        icon: i.icon,
        prep: i.prep,
        quantity: this.scaleIngredient(i, factor).quantity,
        inPantry: ctx.pantry.has(i.ingredientId),
        inShoppingList: listIds.has(i.ingredientId),
        isBasic: i.isBasic,
      })),
      compatibility: e.evaluation.compatibility,
      viewer: { isSaved: flags.saved.has(recipe.id), isLiked: flags.liked.has(recipe.id) },
      chefThreadId: threadId,
      chefConsultable: recipe.chefConsultable.enabled,
      shareUrl: `${this.shareBaseUrl}/r/${recipe.slug ?? recipe.id}`,
    };
  }

  private async authorOf(authorId: string) {
    const u = await this.users.findById(authorId);
    return { type: 'user' as const, id: authorId, displayName: u ? `${u.name}${u.lastName ? ` ${u.lastName.charAt(0)}.` : ''}` : 'Alguien' };
  }

  /**
   * Ingredientes listos para cocinar o comprar: adaptados y escalados.
   * Usa la adaptación pedida si existe; si no, la vigente del usuario.
   * `exec`: la transacción del llamador. Si crea una adaptación, se guarda (con su evento) dentro de ella.
   */
  async resolvedFor(userId: string, recipeId: string, servings: number, adaptationId?: string | null, ctx?: UserContext, exec: Executor = this.db) {
    const recipe = await this.getVisible(userId, recipeId);
    const c = ctx ?? (await this.context(userId));
    const rows = (await this.ingredientsFor([recipe.id])).get(recipe.id) ?? [];
    const e = this.evaluate(recipe, rows, c);
    let adaptation: AdaptationRow | null = null;
    if (adaptationId) {
      adaptation = await this.repo.adaptationById(adaptationId);
      if (!adaptation || adaptation.userId !== userId || adaptation.recipeId !== recipeId) throw Errors.unprocessable('INVALID_ADAPTATION', 'Esa adaptación no corresponde a esta receta.');
    } else {
      adaptation = await this.ensureAdaptation(c, e, exec);
    }
    if (adaptation) {
      const swap = new Map(adaptation.substitutions.map((s) => [s.from.ingredientId, s.to.ingredientId]));
      e.ingredients = rows.map((r) => {
        const id = swap.get(r.ingredientId) ?? r.ingredientId;
        const ing = this.catalog.ingredientOrThrow(id);
        return { ingredientId: id, originalIngredientId: r.ingredientId, label: ing.label, icon: ing.icon, value: r.value, unit: r.unit, prep: r.prep, isSubstitute: id !== r.ingredientId, isBasic: ing.isBasic };
      });
    }
    const factor = servings / recipe.baseServings;
    return { recipe, rows, evaluated: e, adaptation, factor, ingredients: e.ingredients.map((i) => ({ ...i, value: i.value === null ? null : i.value * factor })) };
  }

  /** Pasos para modo cocina: sustituciones aplicadas, cantidades escaladas y alertas de cambio de calor. */
  cookingSteps(recipe: RecipeRow, rows: RecipeIngredientRow[], adaptation: AdaptationRow | null, factor: number): CookingStepSnapshot[] {
    const subs = adaptation?.substitutions ?? [];
    const swap = new Map(subs.map((s) => [s.from.ingredientId, s]));
    const replaceText = (text: string) =>
      subs.reduce((t, s) => t.replace(new RegExp(s.from.label, 'gi'), s.to.label.toLowerCase()), text);
    const notes = new Map((adaptation?.stepNotes ?? []).map((n) => [n.stepIndex, n.text]));
    let lastHeat = 0;
    const templates = this.withIngredients(recipe, recipe.steps.length ? recipe.steps : this.structureUserSteps(recipe), rows);
    return templates.map((st, index) => {
      const subSteps = st.subSteps.map((ss, j) => {
        let heatChange: { from: number; to: number; message: string } | undefined;
        if (ss.heatLevel > 0 && lastHeat > 0 && ss.heatLevel !== lastHeat) {
          const up = ss.heatLevel > lastHeat;
          heatChange = { from: lastHeat, to: ss.heatLevel, message: `${up ? 'Sube' : 'Baja'} a fuego ${heatLabel(ss.heatLevel).toLowerCase()}` };
        }
        if (ss.heatLevel > 0) lastHeat = ss.heatLevel;
        const note = j === 0 ? notes.get(index) : undefined;
        return {
          index: j,
          shortLabel: replaceText(ss.shortLabel),
          text: replaceText(ss.text) + (note ? ` ${note}` : ''),
          timerSeconds: ss.timerSeconds,
          heatLevel: ss.heatLevel,
          ...(heatChange ? { heatChange } : {}),
        };
      });
      return {
        index,
        title: replaceText(st.title),
        durationSeconds: st.durationSeconds,
        heat: { level: st.heatLevel, label: heatLabel(st.heatLevel) },
        equipment: st.equipment,
        ingredients: st.ingredients.map((si) => {
          const sub = si.ingredientId ? swap.get(si.ingredientId) : undefined;
          const id = sub ? sub.to.ingredientId : si.ingredientId;
          const value = si.value === null ? null : si.value * factor;
          return {
            ingredientId: id,
            label: si.label ?? (id ? this.catalog.label(id) : ''),
            prep: si.prep,
            quantity: this.catalog.quantity(id, value, si.unit),
            ...(si.fromStepIndex !== undefined ? { fromStepIndex: si.fromStepIndex } : {}),
          };
        }),
        subSteps,
        doneWhen: st.doneWhen,
      };
    });
  }

  /** Recetas de usuario sin estructura: cada paso es un subpaso con su temporizador. */
  /**
   * Completa los ingredientes de cada paso. Las recetas que ya los traen no se tocan; las publicadas por usuarios antes
   * de esto los tienen todos en el primer paso, así que se reparten de nuevo.
   */
  private withIngredients(recipe: RecipeRow, steps: StepTemplate[], rows: RecipeIngredientRow[]): StepTemplate[] {
    const [first, ...rest] = steps;
    if (!first || rest.some((s) => s.ingredients.length) || (first.ingredients.length && recipe.authorType !== 'user')) return steps;
    const texts = steps.map((s, i) => ({
      text: [s.title, ...s.subSteps.map((x) => x.text)].join('. '),
      // Los pasos estructurados salen uno a uno de los del usuario.
      ingredientIds: recipe.userSteps.length === steps.length ? recipe.userSteps[i]!.ingredientIds : undefined,
    }));
    const uses = assignStepIngredients(
      texts,
      rows.map((r) => ({ id: r.ingredientId, label: this.catalog.label(r.ingredientId), categoryId: this.catalog.ingredient(r.ingredientId)?.categoryId })),
    );
    return steps.map((s, i) => ({ ...s, ingredients: uses[i]!.map((k) => ({ ingredientId: rows[k]!.ingredientId, prep: rows[k]!.prep, value: rows[k]!.value, unit: rows[k]!.unit })) }));
  }

  structureUserSteps(recipe: RecipeRow): StepTemplate[] {
    const heatOf = { low: 2, medium: 5, high: 8 } as const;
    return recipe.userSteps.map((s, i) => ({
      title: s.text.split(/[.:]/)[0]!.slice(0, 60) || `Paso ${i + 1}`,
      durationSeconds: s.timerSeconds ?? 0,
      heatLevel: s.heat ? heatOf[s.heat] : 0,
      equipment: null,
      ingredients: [],
      subSteps: [{ shortLabel: s.text.split(/[.:]/)[0]!.slice(0, 40), text: s.text, timerSeconds: s.timerSeconds ?? null, heatLevel: s.heat ? heatOf[s.heat] : 0 }],
      doneWhen: null,
    }));
  }

  async applyProposal(userId: string, recipeId: string, proposalId: string) {
    const proposal = await this.repo.proposal(proposalId);
    if (!proposal || proposal.userId !== userId || proposal.recipeId !== recipeId) throw Errors.notFound('Esa propuesta no existe.');
    if (proposal.expiresAt < new Date()) throw Errors.gone('PROPOSAL_EXPIRED', 'La propuesta venció. Pregúntale de nuevo al chef.');
    const recipe = await this.getVisible(userId, recipeId);
    const ctx = await this.context(userId);
    const rows = (await this.ingredientsFor([recipe.id])).get(recipe.id) ?? [];
    const e = this.evaluate(recipe, rows, ctx);
    const subs = e.evaluation.substitutions;
    await this.db.transaction(async (tx) => {
      const row = await this.repo.activateAdaptation(tx, {
        id: newId('adaptation'),
        userId,
        recipeId,
        reasons: [...e.evaluation.reasons, { id: proposal.kind, label: proposal.kind === 'airfryer' ? 'en airfryer' : proposal.summary }],
        substitutions: subs,
        stepNotes: proposal.stepNotes,
        source: 'proposal',
        preferencesHash: hashOf({ subs: subs.map((s) => [s.from.ingredientId, s.to.ingredientId, s.reason]) }),
      });
      await this.repo.markProposalApplied(tx, proposal.id);
      await this.outbox.record(tx, 'recipe.adapted', { userId, recipeId, adaptationId: row.id, source: 'proposal' });
    });
    this.outbox.kick();
    return this.detail(userId, recipeId, { adapted: true });
  }

  async setSaved(userId: string, recipeId: string, saved: boolean) {
    await this.getVisible(userId, recipeId);
    if (saved) await this.repo.save(userId, recipeId);
    else await this.repo.unsave(userId, recipeId);
    await this.outbox.publish('recipe.saved', { userId, recipeId, saved });
  }

  async setLiked(userId: string, recipeId: string, liked: boolean) {
    await this.getVisible(userId, recipeId);
    await this.db.transaction(async (tx) => {
      const changed = liked ? await this.repo.like(tx, userId, recipeId) : await this.repo.unlike(tx, userId, recipeId);
      if (changed) await this.outbox.record(tx, 'recipe.liked', { userId, recipeId, liked });
    });
    this.outbox.kick();
    const r = await this.repo.byId(recipeId);
    return { liked, likes: r?.likesCount ?? 0 };
  }

  reasonsLabel(reasons: Labeled[]) {
    return reasons.map((r, i) => (i === 0 ? r.label : r.label.toLowerCase())).join(' · ');
  }
}
