import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { PantryRepository } from './pantry.repository.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { ShoppingService } from '../shopping/shopping.service.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import { cop } from '../../core/shared/money.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

const CDN = 'https://cdn.noshy.app';
const CATEGORY_ORDER = ['produce', 'protein', 'seafood', 'dairy', 'drinks', 'staples', 'bakery', 'spices'];

/** «Tu despensa» del onboarding: lista sugerida desde los platos favoritos y respuestas «Lo tengo / Me falta». */
export class PantrySetupService {
  constructor(
    private readonly db: Db,
    private readonly pantry: PantryRepository,
    private readonly recipesRepo: RecipesRepository,
    private readonly recipes: RecipesService,
    private readonly recommendations: RecommendationsService,
    private readonly shopping: ShoppingService,
    private readonly catalog: CatalogService,
    private readonly outbox: Outbox,
  ) {}

  async suggestions(userId: string, limit = 40) {
    const ctx = await this.recipes.context(userId);
    const favorites = ctx.prefs.favoriteDishIds;
    const published = await this.recipesRepo.published();
    let pool = published.filter((r) => r.dishId && favorites.includes(r.dishId));
    if (pool.length === 0) {
      const ranked = await this.recommendations.ranked(userId, {}, ctx);
      pool = ranked.slice(0, 4).map((r) => r.e.recipe);
    }
    const evaluated = await this.recipes.evaluateMany(pool, ctx);
    const items = new Map<string, { ingredientId: string; usedIn: Map<string, string>; isBasic: boolean }>();
    const hidden = new Set<string>();
    for (const e of evaluated) {
      if (!e.evaluation.compatibility.ok) {
        e.ingredients.forEach((i) => hidden.add(i.originalIngredientId));
        continue;
      }
      e.evaluation.substitutions.forEach((s) => hidden.add(s.from.ingredientId));
      const dish = e.recipe.dishId ? this.catalog.dish(e.recipe.dishId) : null;
      for (const i of e.ingredients) {
        const entry = items.get(i.ingredientId) ?? { ingredientId: i.ingredientId, usedIn: new Map(), isBasic: i.isBasic };
        entry.usedIn.set(dish?.id ?? e.recipe.id, dish?.label ?? e.recipe.title);
        items.set(i.ingredientId, entry);
      }
    }
    for (const id of items.keys()) hidden.delete(id);
    const store = ctx.prefs.shopping.storeIds[0] ?? 'exito';
    const all = [...items.values()].slice(0, Math.min(limit, 60));
    const groups = new Map<string, unknown[]>();
    for (const it of all) {
      const ing = this.catalog.ingredientOrThrow(it.ingredientId);
      const cheapest = ctx.prefs.shopping.storeIds
        .map((s) => this.catalog.cheapest(it.ingredientId, s)?.price ?? null)
        .filter((p): p is number => p !== null)
        .sort((a, b) => a - b)[0];
      const list = groups.get(ing.categoryId) ?? [];
      list.push({
        ingredientId: ing.id,
        label: ing.label,
        imageUrl: `${CDN}/ingredients/${ing.id.slice(4)}.webp`,
        usedIn: [...it.usedIn].map(([dishId, label]) => ({ dishId, label })),
        commonlyInPantry: it.isBasic || ing.categoryId === 'spices' || ing.categoryId === 'staples',
        packLabel: ing.typicalPack.label,
        estimatedPrice: cheapest !== undefined ? cop(cheapest) : this.catalog.cheapest(it.ingredientId, store) ? cop(this.catalog.cheapest(it.ingredientId, store)!.price) : null,
      });
      groups.set(ing.categoryId, list);
    }
    return {
      basedOn: favorites.map((d) => ({ dishId: d, label: this.catalog.dish(d)?.label ?? d })),
      groups: CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ id: c, label: this.catalog.categoryLabel(c), items: groups.get(c)! })),
      totalItems: all.length,
      hiddenByRestrictions: hidden.size,
    };
  }

  async bulk(userId: string, tz: string, input: { answers: { ingredientId: string; status: 'have' | 'missing' }[]; skipped: boolean }) {
    if (input.skipped && input.answers.length) throw Errors.validation([field('answers', 'NOT_ALLOWED', 'Con skipped en true, answers va vacío.')]);
    const seen = new Set<string>();
    const errs = input.answers.flatMap((a, i) => {
      if (!this.catalog.hasIngredient(a.ingredientId)) return [field(`answers.${i}.ingredientId`, 'INVALID_OPTION', `Ingrediente desconocido: ${a.ingredientId}`)];
      if (seen.has(a.ingredientId)) return [field(`answers.${i}.ingredientId`, 'DUPLICATE_INGREDIENT', 'Ingrediente repetido.')];
      seen.add(a.ingredientId);
      return [];
    });
    if (errs.length) throw Errors.validation(errs);

    const result = await this.db.transaction(async (tx) => {
      const have = input.answers.filter((a) => a.status === 'have').map((a) => a.ingredientId);
      const missing = input.answers.filter((a) => a.status === 'missing').map((a) => a.ingredientId);
      const existing = await this.pantry.byIngredients(userId, [...have, ...missing], tx);
      const toInsert = have.filter((id) => !existing.some((e) => e.ingredientId === id && !e.productId));
      const inserted = await this.pantry.insertMany(
        tx,
        toInsert.map((ingredientId) => ({ id: newId('pantryItem'), userId, ingredientId, source: 'onboarding', storage: null, remainingPct: null, expiresOn: null })),
      );
      let removed = 0;
      for (const id of missing) removed += (await this.pantry.deleteByIngredientWithoutProduct(tx, userId, id)).length;
      if (inserted.length) await this.outbox.record(tx, 'pantry.items_added', { userId, itemIds: inserted.map((r) => r.id), ingredientIds: toInsert, source: 'onboarding' });
      const shopping = missing.length
        ? await this.shopping.addIngredientsTx(tx, userId, tz, missing.map((ingredientId) => ({ ingredientId })))
        : null;
      const total = (await this.pantry.storageCounts(userId)).all + inserted.length;
      return { added: inserted.length, removed, total, shopping };
    });
    this.outbox.kick();
    const total = (await this.pantry.storageCounts(userId)).all;
    return {
      pantry: { added: result.added, removed: result.removed, total },
      shoppingList: { added: result.shopping?.added ?? 0, total: result.shopping?.progress.total ?? 0 },
    };
  }
}
