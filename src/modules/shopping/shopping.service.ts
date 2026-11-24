import { randomBytes } from 'node:crypto';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { ShoppingItemRow, ShoppingListRow, ShoppingRepository } from './shopping.repository.js';
import type { ChefRepository } from '../chef/chef.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { PantryService } from '../pantry/pantry.service.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { Unit } from '../../core/domain/quantity.js';
import { cop } from '../../core/shared/money.js';
import { AppError, Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { addDays, localDate, weekStart } from '../../core/shared/time.js';

const CATEGORY_ORDER = ['produce', 'protein', 'seafood', 'dairy', 'drinks', 'bakery', 'staples', 'spices'];
/** Orden de pasillos por tienda para «modo tienda». Sin dato de la tienda, se usa el orden por categoría. */
const STORE_LAYOUT: Record<string, string[]> = {
  d1: ['staples', 'spices', 'drinks', 'dairy', 'protein', 'seafood', 'bakery', 'produce'],
  exito: ['produce', 'bakery', 'staples', 'spices', 'drinks', 'dairy', 'protein', 'seafood'],
};

type Suggestion = {
  id: string;
  kind: 'cheaper' | 'preferredBrand';
  product: { id: string; label: string; brand: string };
  price: { amount: number; currency: 'COP' };
  reason: string;
  savings: { amount: number; currency: 'COP' } | null;
};

const fmtCop = (n: number) => `$${n.toLocaleString('es-CO')}`;

/**
 * Lista de compras de la semana. Totales, ahorro y sugerencias de producto se calculan aquí,
 * en cada lectura y después de cada cambio, para que el front no tenga que deducirlos.
 */
export class ShoppingService {
  constructor(
    private readonly db: Db,
    private readonly repo: ShoppingRepository,
    private readonly catalog: CatalogService,
    private readonly recipes: RecipesService,
    private readonly pantry: PantryService,
    private readonly preferences: PreferencesService,
    private readonly chef: ChefRepository,
    private readonly outbox: Outbox,
    private readonly shareBaseUrl: string,
  ) {}

  // ---------- Lectura ----------
  private async ctx(userId: string, list: ShoppingListRow, storeId?: string) {
    const prefs = await this.preferences.getOrThrow(userId);
    const userStores = prefs.shopping.storeIds.filter((s) => this.catalog.store(s));
    const items = await this.repo.items(list.id);
    const store = storeId ?? list.storeId ?? this.cheapestStore(items, userStores) ?? userStores[0] ?? 'exito';
    const since = new Date(Date.now() - 90 * 86_400_000);
    const signals = await this.chef.signals(userId, since);
    const brandCount = new Map<string, number>();
    for (const s of signals) if (s.brand && (s.kind === 'brandPurchased' || s.kind === 'brandSwapped')) brandCount.set(s.brand, (brandCount.get(s.brand) ?? 0) + 1);
    const preferredBrands = new Set([...brandCount].filter(([, n]) => n >= 2).map(([b]) => b));
    return { prefs, userStores, items, store, preferredBrands };
  }

  private cheapestStore(items: ShoppingItemRow[], stores: string[]): string | null {
    let best: { id: string; total: number } | null = null;
    for (const s of stores) {
      const total = items.reduce((a, i) => a + this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, s, i.productId).price, 0);
      if (!best || total < best.total) best = { id: s, total };
    }
    return best?.id ?? null;
  }

  private estimated(i: ShoppingItemRow, store: string) {
    return this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, store, i.productId);
  }

  private suggestion(i: ShoppingItemRow, store: string, preferredBrands: Set<string>): Suggestion | null {
    if (i.checked) return null;
    const current = this.estimated(i, store);
    const storeName = this.catalog.store(store)?.name ?? store;
    const currentProduct = current.productId ? this.catalog.product(current.productId) : null;
    // 1) Marca que el usuario compra seguido.
    for (const p of this.catalog.productsFor(i.ingredientId)) {
      if (p.id === current.productId || !preferredBrands.has(p.brand)) continue;
      const est = this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, store, p.id);
      if (est.price > 0 && est.price <= current.price * 1.1) {
        const traits = p.tags.includes('sinLactosa') ? 'Sin lactosa: la que más usas' : 'La que más usas';
        return { id: `sug_${p.id}`, kind: 'preferredBrand', product: { id: p.id, label: p.label, brand: p.brand }, price: cop(est.price), reason: traits, savings: est.price < current.price ? cop(current.price - est.price) : null };
      }
    }
    // 2) Producto equivalente más barato en la misma tienda.
    let best: { id: string; price: number } | null = null;
    for (const p of this.catalog.productsFor(i.ingredientId)) {
      if (p.id === current.productId) continue;
      const est = this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, store, p.id);
      if (est.price > 0 && est.price < current.price * 0.95 && (!best || est.price < best.price)) best = { id: p.id, price: est.price };
    }
    if (best) {
      const p = this.catalog.product(best.id)!;
      const diff = current.price - best.price;
      const same = currentProduct?.brand === 'Genérico' ? 'Mismo producto' : 'Mismo corte';
      return { id: `sug_${p.id}`, kind: 'cheaper', product: { id: p.id, label: p.label, brand: p.brand }, price: cop(best.price), reason: `${same}, ${fmtCop(diff)} menos en ${storeName}`, savings: cop(diff) };
    }
    return null;
  }

  private itemDto(i: ShoppingItemRow, store: string, preferredBrands: Set<string>) {
    const ing = this.catalog.ingredientOrThrow(i.ingredientId);
    const est = this.estimated(i, store);
    const product = i.productId ? this.catalog.product(i.productId) : null;
    return {
      id: i.id,
      ingredientId: i.ingredientId,
      label: ing.label,
      icon: ing.icon,
      categoryId: ing.categoryId,
      storage: ing.defaultStorage,
      quantity: this.catalog.quantity(i.ingredientId, i.quantityValue, i.quantityUnit),
      price: { estimated: cop(est.price), actual: i.actualPrice !== null ? cop(i.actualPrice) : null },
      checked: i.checked,
      product: product ? { id: product.id, label: product.label, brand: product.brand } : null,
      suggestion: this.suggestion(i, store, preferredBrands),
      sourceRecipeIds: i.sourceRecipeIds,
      carriedOver: i.carriedOver,
    };
  }

  private totals(items: ShoppingItemRow[], store: string, userStores: string[]) {
    let spent = 0;
    let estimated = 0;
    let swaps = 0;
    let storeChoice = 0;
    for (const i of items) {
      const est = this.estimated(i, store).price;
      estimated += est;
      if (i.checked) spent += i.actualPrice ?? est;
      if (i.productId) {
        const generic = this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, store, null).price;
        if (generic > est) swaps += generic - est;
      }
      const others = userStores.filter((s) => s !== store).map((s) => this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, s, i.productId).price).filter((p) => p > 0);
      if (others.length) {
        const avg = others.reduce((a, b) => a + b, 0) / others.length;
        if (avg > est) storeChoice += avg - est;
      }
    }
    const savingsTotal = Math.round((swaps + storeChoice) / 100) * 100;
    return {
      spent: cop(spent),
      estimated: cop(estimated),
      savings: { ...cop(savingsTotal), breakdown: { swaps: Math.round(swaps), storeChoice: Math.round(storeChoice) } },
    };
  }

  private progress(items: ShoppingItemRow[]) {
    return { inCart: items.filter((i) => i.checked).length, total: items.length };
  }

  private filters(items: ShoppingItemRow[]) {
    const counts = new Map<string, number>();
    let fridge = 0;
    for (const i of items) {
      const ing = this.catalog.ingredientOrThrow(i.ingredientId);
      counts.set(ing.categoryId, (counts.get(ing.categoryId) ?? 0) + 1);
      if (ing.defaultStorage === 'fridge') fridge++;
    }
    return [
      { id: 'all', label: 'Todo', count: items.length },
      ...(fridge ? [{ id: 'fridge', label: 'Nevera', count: fridge }] : []),
      ...CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({ id: c, label: this.catalog.categoryLabel(c), count: counts.get(c)! })),
    ];
  }

  async current(userId: string, q: { storeId?: string; sort?: 'category' | 'storeLayout' }) {
    const list = await this.repo.active(userId);
    if (!list) throw new AppError(404, 'NO_ACTIVE_LIST', 'Todavía no tienes lista esta semana.');
    return this.render(userId, list, q);
  }

  async render(userId: string, list: ShoppingListRow, q: { storeId?: string; sort?: 'category' | 'storeLayout' } = {}) {
    if (q.storeId && !this.catalog.store(q.storeId)) throw Errors.validation([field('storeId', 'INVALID_OPTION', 'Tienda desconocida.')]);
    const { items, store, userStores, preferredBrands } = await this.ctx(userId, list, q.storeId);
    const recipes = await this.repo.recipes(list.id);
    const titles = await this.recipes.cards(userId, recipes.map((r) => r.recipeId)).catch(() => []);
    const order = q.sort === 'storeLayout' ? (STORE_LAYOUT[store] ?? CATEGORY_ORDER) : CATEGORY_ORDER;
    const byCat = new Map<string, ShoppingItemRow[]>();
    for (const i of items) {
      const cat = this.catalog.ingredientOrThrow(i.ingredientId).categoryId;
      byCat.set(cat, [...(byCat.get(cat) ?? []), i]);
    }
    const groups = order
      .filter((c) => byCat.has(c))
      .map((c, idx) => ({
        id: `grp_${c}`,
        label: q.sort === 'storeLayout' ? `Pasillo ${idx + 1} · ${this.catalog.categoryLabel(c)}` : this.catalog.categoryLabel(c),
        items: byCat.get(c)!.map((i) => this.itemDto(i, store, preferredBrands)),
      }));
    return {
      id: list.id,
      weekStart: list.weekStart,
      status: list.status,
      recipes: recipes.map((r) => ({ recipeId: r.recipeId, title: titles.find((t) => t.id === r.recipeId)?.title ?? '', servings: r.servings })),
      store: { id: store, name: this.catalog.store(store)?.name ?? store },
      totals: this.totals(items, store, userStores),
      progress: this.progress(items),
      filters: this.filters(items),
      groups,
    };
  }

  private async activeOrThrow(userId: string, listId: string, exec: Executor = this.db) {
    const list = await this.repo.byId(userId, listId, exec);
    if (!list) throw Errors.notFound('Esa lista no existe.');
    if (list.status !== 'active') throw Errors.conflict('LIST_CLOSED', 'Esa lista ya se cerró.');
    return list;
  }

  // ---------- Cambios ----------
  async patchItem(userId: string, listId: string, itemId: string, patch: { checked?: boolean; quantity?: { value: number; unit: Unit }; actualPrice?: { amount: number } | null }) {
    const list = await this.activeOrThrow(userId, listId);
    const item = await this.repo.item(list.id, itemId);
    if (!item) throw Errors.notFound('Ese ítem no está en la lista.');
    if (patch.quantity) {
      const ing = this.catalog.ingredientOrThrow(item.ingredientId);
      if (!ing.allowedUnits.includes(patch.quantity.unit)) throw Errors.validation([field('quantity.unit', 'INVALID_UNIT', `Unidad no permitida para ${ing.label}.`)]);
    }
    await this.db.transaction(async (tx) => {
      await this.repo.updateItem(tx, item.id, {
        ...(patch.checked !== undefined ? { checked: patch.checked, checkedAt: patch.checked ? new Date() : null } : {}),
        ...(patch.quantity ? { quantityValue: patch.quantity.value, quantityUnit: patch.quantity.unit } : {}),
        ...(patch.actualPrice !== undefined ? { actualPrice: patch.actualPrice?.amount ?? null } : {}),
      });
      if (patch.checked !== undefined && patch.checked !== item.checked) {
        await this.outbox.record(tx, 'shopping.item_checked', { userId, listId, itemId, checked: patch.checked });
      }
    });
    this.outbox.kick();
    return this.itemAndTotals(userId, list, itemId);
  }

  private async itemAndTotals(userId: string, list: ShoppingListRow, itemId: string) {
    const { items, store, userStores, preferredBrands } = await this.ctx(userId, list);
    const item = items.find((i) => i.id === itemId)!;
    return { item: this.itemDto(item, store, preferredBrands), totals: this.totals(items, store, userStores), progress: this.progress(items) };
  }

  async swap(userId: string, listId: string, itemId: string, suggestionId: string) {
    const list = await this.activeOrThrow(userId, listId);
    const { items, store, preferredBrands } = await this.ctx(userId, list);
    const item = items.find((i) => i.id === itemId);
    if (!item) throw Errors.notFound('Ese ítem no está en la lista.');
    const sug = this.suggestion(item, store, preferredBrands);
    if (!sug || sug.id !== suggestionId) {
      throw Errors.gone('SUGGESTION_EXPIRED', 'El precio cambió y esa sugerencia ya no aplica.', { item: this.itemDto(item, store, preferredBrands) });
    }
    await this.db.transaction(async (tx) => {
      await this.repo.updateItem(tx, item.id, { productId: sug.product.id, estimatedPrice: sug.price.amount });
      await this.outbox.record(tx, 'shopping.item_swapped', { userId, listId, itemId, productId: sug.product.id, brand: sug.product.brand, savings: sug.savings?.amount ?? 0 });
    });
    this.outbox.kick();
    const r = await this.itemAndTotals(userId, list, itemId);
    return { item: r.item, totals: r.totals };
  }

  /** Lista activa de la semana; la crea si no hay. */
  async ensureActive(exec: Executor, userId: string, tz: string): Promise<ShoppingListRow> {
    const existing = await this.repo.active(userId, exec);
    if (existing) return existing;
    const list = await this.repo.create(exec, { id: newId('shoppingList'), userId, weekStart: weekStart(localDate(new Date(), tz)), status: 'active' });
    await this.outbox.record(exec, 'shopping.list_created', { userId, listId: list.id, weekStart: list.weekStart });
    return list;
  }

  /** Agrega o suma cantidades. Si ya está (sin marcar), suma en la misma unidad o en gramos. */
  async addIngredientsTx(exec: Executor, userId: string, tz: string, items: { ingredientId: string; value?: number | null; unit?: Unit | null; sourceRecipeId?: string | null }[]) {
    const list = await this.ensureActive(exec, userId, tz);
    const current = await this.repo.items(list.id, exec);
    let added = 0;
    let merged = 0;
    const prefs = await this.preferences.getOrThrow(userId);
    const store = list.storeId ?? prefs.shopping.storeIds[0] ?? 'exito';
    for (const it of items) {
      const ing = this.catalog.ingredient(it.ingredientId);
      if (!ing) throw Errors.validation([field('items', 'INVALID_OPTION', `Ingrediente desconocido: ${it.ingredientId}`)]);
      let value = it.value ?? null;
      let unit = it.unit ?? null;
      if (value === null || unit === null || unit === 'toTaste' || unit === 'all') {
        value = ing.typicalPack.value;
        unit = ing.typicalPack.unit;
      }
      const existing = current.find((c) => c.ingredientId === it.ingredientId && !c.checked);
      if (existing) {
        let newValue: number | null = null;
        let newUnit = existing.quantityUnit;
        if (existing.quantityUnit === unit) newValue = existing.quantityValue + value;
        else {
          const a = this.catalog.grams(it.ingredientId, existing.quantityValue, existing.quantityUnit);
          const b = this.catalog.grams(it.ingredientId, value, unit);
          if (a !== null && b !== null) {
            newValue = a + b;
            newUnit = 'g';
          }
        }
        const sources = it.sourceRecipeId && !existing.sourceRecipeIds.includes(it.sourceRecipeId) ? [...existing.sourceRecipeIds, it.sourceRecipeId] : existing.sourceRecipeIds;
        const updated = await this.repo.updateItem(exec, existing.id, {
          ...(newValue !== null ? { quantityValue: newValue, quantityUnit: newUnit } : {}),
          sourceRecipeIds: sources,
        });
        Object.assign(existing, updated);
        merged++;
      } else {
        const est = this.catalog.estimate(it.ingredientId, value, unit, store, null);
        const [row] = await this.repo.insertItems(exec, [
          {
            id: newId('shoppingItem'),
            listId: list.id,
            ingredientId: it.ingredientId,
            quantityValue: value,
            quantityUnit: unit,
            estimatedPrice: est.price,
            sourceRecipeIds: it.sourceRecipeId ? [it.sourceRecipeId] : [],
            position: current.length,
          },
        ]);
        current.push(row!);
        added++;
      }
    }
    return { list, added, merged, progress: this.progress(current) };
  }

  async addItems(userId: string, tz: string, items: { ingredientId: string; quantity?: { value: number; unit: Unit }; sourceRecipeId?: string }[]) {
    await this.catalog.ensure(items.map((i) => i.ingredientId));
    const r = await this.db.transaction((tx) =>
      this.addIngredientsTx(
        tx,
        userId,
        tz,
        items.map((i) => ({ ingredientId: i.ingredientId, value: i.quantity?.value, unit: i.quantity?.unit, sourceRecipeId: i.sourceRecipeId })),
      ),
    );
    this.outbox.kick();
    return { added: r.added, merged: r.merged, progress: r.progress };
  }

  /** Agrega a la lista lo que falta de una receta (adaptada y escalada), sin lo que ya hay en la despensa. */
  async addRecipeTx(exec: Executor, userId: string, tz: string, input: { recipeId: string; servings?: number; adaptationId?: string | null }, opts: { failIfPresent: boolean }) {
    const recipe = await this.recipes.getVisible(userId, input.recipeId);
    const servings = input.servings ?? recipe.baseServings;
    const resolved = await this.recipes.resolvedFor(userId, input.recipeId, servings, input.adaptationId ?? null, undefined, exec);
    const inPantry = await this.pantry.availableIngredientIds(userId);
    const list = await this.ensureActive(exec, userId, tz);
    const isNew = await this.repo.addRecipe(exec, { listId: list.id, recipeId: recipe.id, servings, adaptationId: resolved.adaptation?.id ?? null });
    if (!isNew && opts.failIfPresent) throw Errors.conflict('RECIPE_ALREADY_IN_LIST', 'Esa receta ya está en tu lista.');
    const missing = resolved.ingredients.filter((i) => !inPantry.has(i.ingredientId));
    const r = isNew
      ? await this.addIngredientsTx(exec, userId, tz, missing.map((i) => ({ ingredientId: i.ingredientId, value: i.value, unit: i.unit, sourceRecipeId: recipe.id })))
      : { added: 0, merged: 0, progress: this.progress(await this.repo.items(list.id, exec)) };
    return { added: r.added, merged: r.merged, skippedInPantry: resolved.ingredients.length - missing.length, progress: r.progress };
  }

  async addRecipe(userId: string, tz: string, input: { recipeId: string; servings?: number; adaptationId?: string | null }) {
    const r = await this.db.transaction((tx) => this.addRecipeTx(tx, userId, tz, input, { failIfPresent: true }));
    this.outbox.kick();
    return r;
  }

  /**
   * Saca una receta de la lista activa: borra lo pendiente que solo venía de esa receta
   * y la quita de las fuentes de lo compartido. Lo ya marcado no se toca.
   */
  async removeRecipeTx(exec: Executor, userId: string, recipeId: string) {
    const list = await this.repo.active(userId, exec);
    if (!list) return { removed: 0 };
    const removedRecipe = await this.repo.removeRecipe(exec, list.id, recipeId);
    if (!removedRecipe) return { removed: 0 };
    const items = await this.repo.items(list.id, exec);
    const toDelete: string[] = [];
    for (const i of items) {
      if (i.checked || !i.sourceRecipeIds.includes(recipeId)) continue;
      const rest = i.sourceRecipeIds.filter((r) => r !== recipeId);
      if (rest.length === 0) toDelete.push(i.id);
      else await this.repo.updateItem(exec, i.id, { sourceRecipeIds: rest });
    }
    await this.repo.deleteItems(exec, toDelete);
    return { removed: toDelete.length };
  }

  /** Vista pública del enlace compartido (sin login). */
  async sharedView(token: string) {
    const list = await this.repo.byShareToken(token);
    if (!list) throw Errors.notFound('Ese enlace no existe.');
    if (list.shareExpiresAt && list.shareExpiresAt < new Date()) throw Errors.gone('LINK_EXPIRED', 'Este enlace ya venció.');
    const items = await this.repo.items(list.id);
    const store = list.storeId ?? 'exito';
    return {
      weekStart: list.weekStart,
      status: list.status,
      progress: this.progress(items),
      groups: CATEGORY_ORDER.map((c) => ({
        id: c,
        label: this.catalog.categoryLabel(c),
        items: items
          .filter((i) => this.catalog.ingredientOrThrow(i.ingredientId).categoryId === c)
          .map((i) => ({ label: this.catalog.label(i.ingredientId), quantity: this.catalog.quantity(i.ingredientId, i.quantityValue, i.quantityUnit).display, checked: i.checked })),
      })).filter((g) => g.items.length),
      estimated: cop(items.reduce((a, i) => a + this.estimated(i, store).price, 0)),
      expiresAt: list.shareExpiresAt?.toISOString() ?? null,
    };
  }

  async share(userId: string, listId: string) {
    const list = await this.repo.byId(userId, listId);
    if (!list) throw Errors.notFound('Esa lista no existe.');
    const token = list.shareToken ?? randomBytes(5).toString('base64url');
    const expiresAt = new Date(`${addDays(list.weekStart, 7)}T05:00:00Z`);
    await this.repo.update(this.db, list.id, { shareToken: token, shareExpiresAt: expiresAt });
    const items = await this.repo.items(list.id);
    const [, m, d] = list.weekStart.split('-').map(Number);
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const lines = items.map((i) => `${i.checked ? '☑' : '☐'} ${this.catalog.label(i.ingredientId)} · ${this.catalog.quantity(i.ingredientId, i.quantityValue, i.quantityUnit).display}`);
    return { url: `${this.shareBaseUrl}/l/${token}`, text: [`Lista de compras · semana del ${d} ${months[(m ?? 1) - 1]}`, ...lines].join('\n'), expiresAt: expiresAt.toISOString() };
  }

  async checkout(userId: string, tz: string, listId: string, input: { storeId: string; carryOverUnchecked: boolean; receiptId?: string }) {
    if (!this.catalog.store(input.storeId)) throw Errors.validation([field('storeId', 'INVALID_OPTION', 'Tienda desconocida.')]);
    const result = await this.db.transaction(async (tx) => {
      const list = await this.activeOrThrow(userId, listId, tx);
      const items = await this.repo.items(list.id, tx);
      const checked = items.filter((i) => i.checked);
      if (checked.length === 0) throw Errors.unprocessable('NOTHING_CHECKED', 'No hay nada marcado en la lista.');
      const now = new Date();
      const purchased = checked.map((i) => {
        const est = this.catalog.estimate(i.ingredientId, i.quantityValue, i.quantityUnit, input.storeId, i.productId);
        const product = est.productId ? this.catalog.product(est.productId) : null;
        return {
          ingredientId: i.ingredientId,
          productId: est.productId,
          value: product ? product.packValue * est.packs : i.quantityValue,
          unit: product ? product.packUnit : i.quantityUnit,
          storeId: input.storeId,
          price: i.actualPrice ?? est.price,
          purchasedAt: now,
        };
      });
      const spent = purchased.reduce((a, p) => a + (p.price ?? 0), 0);
      const pantryRows = await this.pantry.addPurchased(tx, userId, tz, purchased, 'shoppingList');
      await this.repo.update(tx, list.id, { status: 'completed', completedAt: now, spent, storeId: input.storeId });
      const unchecked = items.filter((i) => !i.checked);
      let carriedOver = 0;
      if (input.carryOverUnchecked && unchecked.length) {
        const next = await this.repo.create(tx, { id: newId('shoppingList'), userId, weekStart: weekStart(localDate(now, tz)), status: 'active' });
        await this.repo.insertItems(
          tx,
          unchecked.map((i, idx) => ({ ...i, id: newId('shoppingItem'), listId: next.id, carriedOver: true, position: idx, createdAt: now })),
        );
        carriedOver = unchecked.length;
      }
      await this.outbox.record(tx, 'shopping.checked_out', { userId, listId: list.id, storeId: input.storeId, pantryItemIds: pantryRows.map((r) => r.id), spent });
      return { spent, pantryAdded: pantryRows.length, carriedOver, weekStart: list.weekStart };
    });
    this.outbox.kick();
    const prefs = await this.preferences.getOrThrow(userId);
    const spentThisWeek = await this.repo.spentInWeek(userId, result.weekStart);
    return {
      listStatus: 'completed' as const,
      spent: cop(result.spent),
      pantryAdded: result.pantryAdded,
      carriedOver: result.carriedOver,
      budget: { weekly: prefs.shopping.weeklyBudget, spentThisWeek: cop(spentThisWeek) },
    };
  }
}
