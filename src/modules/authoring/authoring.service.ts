import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { RecipesRepository, RecipeRow } from '../recipes/recipes.repository.js';
import type { MediaRepository } from '../media/media.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import type { Moderation } from '../community/community.providers.js';
import type { ChefConsultable, UserStep } from '../../infrastructure/database/postgres/types.js';
import { recipeNutrition } from '../../core/domain/nutrition.js';
import { DIFFICULTIES, labelOf, type Difficulty } from '../../core/domain/catalog.js';
import type { Unit } from '../../core/domain/quantity.js';
import { decodeCursor, encodeCursor } from '../../core/shared/cursor.js';
import { Errors, field, type FieldError } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

export type MyRecipePatch = Partial<{
  title: string;
  coverMediaId: string;
  totalTimeMinutes: number;
  servings: number;
  difficulty: Difficulty;
  ingredients: { ingredientId: string; quantity: { value: number; unit: Unit }; prep?: string }[];
  steps: UserStep[];
  chefConsultable: ChefConsultable;
}>;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

/** Crear recetas: borrador con autoguardado, foto por URL firmada, macros calculadas y publicación con moderación. */
export class AuthoringService {
  constructor(
    private readonly db: Db,
    private readonly recipesRepo: RecipesRepository,
    private readonly media: MediaRepository,
    private readonly users: UsersRepository,
    private readonly recipes: RecipesService,
    private readonly catalog: CatalogService,
    private readonly storage: Storage,
    private readonly moderation: Moderation,
    private readonly outbox: Outbox,
    private readonly shareBaseUrl: string,
  ) {}

  // ---------- Recetas propias ----------
  dto(r: RecipeRow) {
    const ingredientsCount = this.ingredientCount.get(r.id) ?? 0;
    return {
      id: r.id,
      status: r.status,
      title: r.title,
      coverImageUrl: r.imageUrl,
      totalTimeMinutes: r.timeMax,
      servings: r.baseServings,
      difficulty: r.difficulty ? { id: r.difficulty, label: labelOf(DIFFICULTIES, r.difficulty) } : null,
      nutritionPerServing: r.nutritionPerServing,
      nutritionStatus: r.nutritionStatus,
      summary: { ingredientsCount, stepsCount: r.userSteps.length, stepsWithTimer: r.userSteps.filter((s) => s.timerSeconds).length },
      chefConsultable: r.chefConsultable,
      ...(r.rejectionReason ? { rejectionReason: r.rejectionReason } : {}),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  private ingredientCount = new Map<string, number>();

  private async withCounts(rows: RecipeRow[]) {
    const ings = await this.recipesRepo.ingredientsFor(rows.map((r) => r.id));
    for (const r of rows) this.ingredientCount.set(r.id, ings.get(r.id)?.length ?? 0);
    return rows.map((r) => this.dto(r));
  }

  async create(userId: string, input: { title?: string }) {
    const r = await this.recipesRepo.insert(this.db, {
      id: newId('recipe'),
      authorType: 'user',
      authorId: userId,
      status: 'draft',
      title: input.title?.trim() ?? '',
      baseServings: 2,
      mealSlots: ['lunch', 'dinner'],
    });
    return (await this.withCounts([r]))[0]!;
  }

  private async ownDraft(userId: string, recipeId: string) {
    const r = await this.recipesRepo.byId(recipeId);
    if (!r || r.authorId !== userId) throw Errors.notFound('Esa receta no existe.');
    return r;
  }

  async patch(userId: string, recipeId: string, patch: MyRecipePatch, ifMatch?: string) {
    const r = await this.ownDraft(userId, recipeId);
    if (r.status === 'published' || r.status === 'inReview') throw Errors.conflict('ALREADY_PUBLISHED', 'La receta ya se publicó y no se puede editar.');
    if (ifMatch && ifMatch !== r.updatedAt.toISOString()) throw Errors.conflict('VERSION_CONFLICT', 'La receta cambió en otro dispositivo.', { updatedAt: r.updatedAt.toISOString() });
    if (patch.ingredients) await this.catalog.ensure(patch.ingredients.map((i) => i.ingredientId));
    const errs: FieldError[] = [];
    patch.ingredients?.forEach((i, idx) => {
      const ing = this.catalog.ingredient(i.ingredientId);
      if (!ing) errs.push(field(`ingredients.${idx}.ingredientId`, 'INVALID_OPTION', 'Ingrediente desconocido.'));
      else if (!ing.allowedUnits.includes(i.quantity.unit)) errs.push(field(`ingredients.${idx}.quantity.unit`, 'INVALID_UNIT', `Unidad no permitida para ${ing.label}.`));
    });
    let imageUrl: string | undefined;
    if (patch.coverMediaId) {
      const m = await this.media.ownedUploaded(userId, patch.coverMediaId);
      if (!m) errs.push(field('coverMediaId', 'INVALID_OPTION', 'La foto no existe o no terminó de subir.'));
      else imageUrl = this.storage.publicUrl(m.storageKey);
    }
    if (errs.length) throw Errors.validation(errs);

    const updated = await this.db.transaction(async (tx) => {
      if (patch.ingredients) {
        await this.recipesRepo.replaceIngredients(
          tx,
          recipeId,
          patch.ingredients.map((i, position) => ({ ingredientId: i.ingredientId, value: i.quantity.value, unit: i.quantity.unit, prep: i.prep ?? null, position })),
        );
      }
      const ingredients = (await this.recipesRepo.ingredientsFor([recipeId], tx)).get(recipeId) ?? [];
      const servings = patch.servings ?? r.baseServings;
      const nutrition = recipeNutrition(
        ingredients.map((i) => ({ value: i.value, unit: i.unit, nutrition: this.catalog.nutrition(i.ingredientId) })),
        servings,
      );
      return this.recipesRepo.update(tx, recipeId, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.coverMediaId ? { coverMediaId: patch.coverMediaId, imageUrl } : {}),
        ...(patch.totalTimeMinutes !== undefined ? { timeMin: patch.totalTimeMinutes, timeMax: patch.totalTimeMinutes } : {}),
        ...(patch.servings !== undefined ? { baseServings: patch.servings } : {}),
        ...(patch.difficulty ? { difficulty: patch.difficulty } : {}),
        ...(patch.steps ? { userSteps: patch.steps } : {}),
        ...(patch.chefConsultable ? { chefConsultable: patch.chefConsultable } : {}),
        nutritionPerServing: nutrition.status === 'empty' ? null : nutrition.perServing,
        nutritionStatus: nutrition.status,
        status: r.status === 'rejected' ? 'draft' : r.status,
      });
    });
    return (await this.withCounts([updated!]))[0]!;
  }

  async publish(userId: string, recipeId: string) {
    const r = await this.ownDraft(userId, recipeId);
    if (r.status === 'published' || r.status === 'inReview') throw Errors.conflict('ALREADY_PUBLISHED', 'Esa receta ya está publicada.');
    const user = await this.users.findById(userId);
    if (!user?.emailVerified) throw Errors.forbidden('EMAIL_NOT_VERIFIED', 'Verifica tu email para publicar.');
    const ingredients = (await this.recipesRepo.ingredientsFor([recipeId])).get(recipeId) ?? [];
    const missing: FieldError[] = [];
    if (!r.coverMediaId) missing.push(field('coverMediaId', 'REQUIRED', 'Agrega una foto.'));
    if (!r.title.trim()) missing.push(field('title', 'REQUIRED', 'Ponle nombre a tu receta.'));
    if (ingredients.length < 2) missing.push(field('ingredients', 'TOO_FEW', 'Agrega al menos 2 ingredientes.'));
    if (r.userSteps.length < 1) missing.push(field('steps', 'TOO_FEW', 'Agrega al menos un paso.'));
    if (missing.length) throw Errors.unprocessable('RECIPE_INCOMPLETE', 'A tu receta le falta información.', missing);
    const slug = `${slugify(r.title)}-${r.id.slice(-6).toLowerCase()}`;
    await this.db.transaction(async (tx) => {
      await this.recipesRepo.update(tx, recipeId, { status: 'inReview', slug });
      await this.outbox.record(tx, 'recipe.publish_requested', { userId, recipeId });
    });
    this.outbox.kick();
    return { id: recipeId, status: 'inReview' as const, publishedAt: null, shareUrl: `${this.shareBaseUrl}/r/${slug}` };
  }

  /** Lo corre el observer `community` con `recipe.publish_requested`: modera, estructura para modo cocina y publica. */
  async moderateAndPublish(recipeId: string) {
    const r = await this.recipesRepo.byId(recipeId);
    if (!r || r.status !== 'inReview') return null;
    const text = [r.title, ...r.userSteps.map((s) => s.text)].join('\n');
    const review = await this.moderation.review({ text, imageKeys: r.coverMediaId ? [r.coverMediaId] : [] });
    if (!review.approved) {
      await this.db.transaction(async (tx) => {
        await this.recipesRepo.update(tx, recipeId, { status: 'rejected', rejectionReason: review.reason ?? 'No pasó la moderación.' });
        await this.outbox.record(tx, 'recipe.rejected', { userId: r.authorId!, recipeId, reason: review.reason ?? '' });
      });
      return 'rejected';
    }
    const steps = this.recipes.structureUserSteps(r);
    await this.db.transaction(async (tx) => {
      await this.recipesRepo.update(tx, recipeId, { status: 'published', publishedAt: new Date(), steps });
      await this.outbox.record(tx, 'recipe.published', { userId: r.authorId!, recipeId });
    });
    return 'published';
  }

  async mine(userId: string, q: { status?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(q.limit ?? 20, 50);
    const c = decodeCursor(q.cursor);
    const rows = await this.recipesRepo.authoredBy(userId, q.status, limit, c ? { k: String(c.k), id: c.id } : null);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      data: (await this.withCounts(items)).map((d) => ({ id: d.id, title: d.title, status: d.status, coverImageUrl: d.coverImageUrl, updatedAt: d.updatedAt })),
      meta: { nextCursor: rows.length > limit && last ? encodeCursor({ k: last.updatedAt.toISOString(), id: last.id }) : null, limit },
    };
  }
}
