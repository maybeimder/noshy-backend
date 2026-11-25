import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { PantryListRow, PantryRepository, PantryRow } from './pantry.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import type { Unit } from '../../core/domain/quantity.js';
import { acceptsUnit } from '../../core/domain/household.js';
import type { Storage } from '../../core/domain/catalog.js';
import { decodeCursor, slicepage } from '../../core/shared/cursor.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { addDays, localDate } from '../../core/shared/time.js';

export type PurchasedItem = {
  ingredientId: string;
  productId: string | null;
  value: number | null;
  unit: Unit | null;
  storeId: string | null;
  price: number | null;
  purchasedAt: Date;
  receiptItemId?: string | null;
};

const FREEZER_MULTIPLIER = 4;
const USE_SOON_DAYS = 3;

/**
 * Mi despensa: lo que el usuario tiene, dónde, cuánto le queda y cuándo vence.
 * El vencimiento se estima por ingrediente (vida útil) y lugar; el usuario puede corregirlo.
 */
export class PantryService {
  constructor(
    private readonly db: Db,
    private readonly repo: PantryRepository,
    private readonly catalog: CatalogService,
    private readonly recommendations: RecommendationsService,
    private readonly outbox: Outbox,
  ) {}

  /** Parte de arriba de Mi despensa. «Mañana», «2 días» los arma el front con `expiresOn`. */
  async overview(userId: string, tz: string) {
    const today = localDate(new Date(), tz);
    const [storageCounts, updatedAt, soon, possible] = await Promise.all([
      this.repo.storageCounts(userId),
      this.repo.lastUpdatedAt(userId),
      this.repo.expiringBefore(userId, addDays(today, USE_SOON_DAYS), 5),
      this.recommendations.possibleWithPantry(userId),
    ]);
    return {
      totalItems: storageCounts.all,
      updatedAt: (updatedAt ?? new Date()).toISOString(),
      recipesPossible: { count: possible.count, period: 'week' as const, previewImageUrls: possible.previewImageUrls },
      useSoon: soon.map((r) => ({ itemId: r.id, label: r.label, icon: r.icon, expiresOn: r.expiresOn! })),
      storageCounts,
    };
  }

  toDto(r: PantryListRow) {
    return {
      id: r.id,
      ingredientId: r.ingredientId,
      label: r.label,
      icon: r.icon,
      categoryId: r.categoryId,
      product: r.productId ? { id: r.productId, brand: r.brand ?? '', packLabel: r.packLabel ?? '' } : null,
      quantity: r.quantityValue !== null && r.quantityUnit ? this.catalog.quantity(r.ingredientId, r.quantityValue, r.quantityUnit) : null,
      remainingPct: r.remainingPct,
      storage: r.storage,
      expiresOn: r.expiresOn,
      expiryEstimated: r.expiryEstimated,
      source: r.source,
      addedAt: r.addedAt.toISOString(),
    };
  }

  estimateExpiry(ingredientId: string, storage: string | null, from: Date, tz: string): string {
    const ing = this.catalog.ingredientOrThrow(ingredientId);
    const days = storage === 'freezer' && ing.defaultStorage !== 'freezer' ? ing.shelfLifeDays * FREEZER_MULTIPLIER : ing.shelfLifeDays;
    return addDays(localDate(from, tz), days);
  }

  async list(userId: string, q: { storage?: Storage; q?: string; sort?: 'recent' | 'expiresOn' | 'name'; cursor?: string; limit?: number }) {
    const limit = Math.min(q.limit ?? 30, 100);
    const sort = q.sort ?? 'recent';
    const rows = await this.repo.list(userId, { storage: q.storage, q: q.q, sort, limit, cursor: decodeCursor(q.cursor) });
    const { items, nextCursor } = slicepage(rows, limit, (r) => ({
      k: sort === 'name' ? r.label : sort === 'expiresOn' ? (r.expiresOn ?? '9999-12-31') : r.addedAt.toISOString(),
      id: r.id,
    }));
    return { data: items.map((r) => this.toDto(r)), meta: { nextCursor, limit } };
  }

  async get(userId: string, itemId: string) {
    const row = await this.repo.byId(userId, itemId);
    if (!row) throw Errors.notFound('Ese ingrediente no está en tu despensa.');
    return row;
  }

  async add(userId: string, tz: string, body: { ingredientId?: string; text?: string; productId?: string; quantity?: { value: number; unit: Unit }; storage?: Storage }) {
    const input = { ...body, ingredientId: body.text !== undefined ? await this.catalog.ensureText(body.text) : (body.ingredientId ?? '') };
    await this.catalog.ensure([input.ingredientId]);
    const ing = this.catalog.ingredient(input.ingredientId);
    if (!ing) throw Errors.validation([field('ingredientId', 'INVALID_OPTION', 'Ingrediente desconocido.')]);
    if (input.productId && this.catalog.product(input.productId)?.ingredientId !== input.ingredientId)
      throw Errors.validation([field('productId', 'INVALID_OPTION', 'Ese producto no corresponde al ingrediente.')]);
    if (input.quantity && !acceptsUnit(ing, input.quantity.unit))
      throw Errors.validation([field('quantity.unit', 'INVALID_UNIT', `Unidad no permitida para ${ing.label}.`)]);
    if (!input.productId) {
      const existing = (await this.repo.byIngredients(userId, [input.ingredientId])).find((p) => !p.productId);
      if (existing) throw Errors.conflict('ALREADY_IN_PANTRY', 'Ya tienes ese ingrediente en tu despensa.', { itemId: existing.id });
    }
    const storage = input.storage ?? (ing.defaultStorage as Storage);
    const now = new Date();
    const product = input.productId ? this.catalog.product(input.productId) : null;
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await this.repo.insertMany(tx, [
        {
          id: newId('pantryItem'),
          userId,
          ingredientId: input.ingredientId,
          productId: input.productId ?? null,
          quantityValue: input.quantity?.value ?? product?.packValue ?? null,
          quantityUnit: input.quantity?.unit ?? product?.packUnit ?? null,
          remainingPct: 100,
          storage,
          expiresOn: this.estimateExpiry(input.ingredientId, storage, now, tz),
          expiryEstimated: true,
          source: 'manual',
        },
      ]);
      await this.outbox.record(tx, 'pantry.items_added', { userId, itemIds: rows.map((r) => r.id), ingredientIds: [input.ingredientId], source: 'manual' });
      return rows;
    });
    this.outbox.kick();
    return this.toDto((await this.repo.byId(userId, row!.id))!);
  }

  async patch(userId: string, itemId: string, patch: { remainingPct?: number; storage?: Storage; expiresOn?: string; quantity?: { value: number; unit: Unit } }) {
    const current = await this.get(userId, itemId);
    const ing = this.catalog.ingredient(current.ingredientId);
    if (patch.quantity && ing && !acceptsUnit(ing, patch.quantity.unit)) throw Errors.validation([field('quantity.unit', 'INVALID_UNIT', `Unidad no permitida para ${ing.label}.`)]);
    await this.db.transaction(async (tx) => {
      await this.repo.update(tx, userId, itemId, {
        ...(patch.remainingPct !== undefined ? { remainingPct: patch.remainingPct } : {}),
        // Una cantidad nueva es lo que hay ahora: vuelve a contar desde lleno, salvo que también diga cuánto queda.
        ...(patch.quantity ? { quantityValue: patch.quantity.value, quantityUnit: patch.quantity.unit, ...(patch.remainingPct === undefined ? { remainingPct: 100 } : {}) } : {}),
        ...(patch.storage ? { storage: patch.storage } : {}),
        ...(patch.expiresOn ? { expiresOn: patch.expiresOn, expiryEstimated: false } : {}),
      });
      await this.outbox.record(tx, 'pantry.item_updated', { userId, itemId, ingredientId: current.ingredientId });
    });
    this.outbox.kick();
    return this.toDto((await this.repo.byId(userId, itemId))!);
  }

  async remove(userId: string, itemId: string, addToShoppingList: boolean) {
    await this.db.transaction(async (tx) => {
      const row = await this.repo.delete(tx, userId, itemId);
      if (!row) throw Errors.notFound('Ese ingrediente no está en tu despensa.');
      await this.outbox.record(tx, 'pantry.item_removed', { userId, itemId, ingredientId: row.ingredientId, addToShoppingList });
    });
    this.outbox.kick();
  }

  /** Lo comprado (lista o factura) entra con producto, cantidad del paquete, precio y vencimiento estimado. */
  async addPurchased(exec: Executor, userId: string, tz: string, items: PurchasedItem[], source: 'shoppingList' | 'receipt'): Promise<PantryRow[]> {
    const rows = items.map((i) => {
      const ing = this.catalog.ingredientOrThrow(i.ingredientId);
      const storage = ing.defaultStorage;
      return {
        id: newId('pantryItem'),
        userId,
        ingredientId: i.ingredientId,
        productId: i.productId,
        quantityValue: i.value,
        quantityUnit: i.unit,
        remainingPct: 100,
        storage,
        expiresOn: this.estimateExpiry(i.ingredientId, storage, i.purchasedAt, tz),
        expiryEstimated: true,
        source,
        storeId: i.storeId,
        purchasePrice: i.price,
        addedAt: i.purchasedAt,
        receiptItemId: i.receiptItemId ?? null,
      };
    });
    // Un ítem del onboarding (sin producto) queda reemplazado por el comprado.
    for (const ingredientId of new Set(items.map((i) => i.ingredientId))) {
      await this.repo.deleteByIngredientWithoutProduct(exec, userId, ingredientId);
    }
    const inserted = await this.repo.insertMany(exec, rows);
    if (inserted.length) {
      await this.outbox.record(exec, 'pantry.items_added', { userId, itemIds: inserted.map((r) => r.id), ingredientIds: [...new Set(items.map((i) => i.ingredientId))], source });
    }
    return inserted;
  }

  /**
   * Descuenta lo usado en una sesión de cocina, empezando por lo que vence primero.
   * Solo descuenta ítems con cantidad conocida; los demás no cambian.
   */
  async consume(
    exec: Executor,
    userId: string,
    sessionId: string,
    usage: { ingredientId: string; value: number | null; unit: Unit }[],
    corrections: { itemId: string; remainingPct: number }[] = [],
  ) {
    const updates: { itemId: string; ingredientId: string; label: string; remainingPct: number; removed: boolean }[] = [];
    const items = await this.repo.byIngredients(userId, [...new Set(usage.map((u) => u.ingredientId))], exec);
    for (const u of usage) {
      let need = this.catalog.grams(u.ingredientId, u.value, u.unit);
      if (need === null || need <= 0) continue;
      for (const item of items.filter((i) => i.ingredientId === u.ingredientId)) {
        if (need <= 0) break;
        if (item.quantityValue === null || !item.quantityUnit || item.remainingPct === null || item.remainingPct <= 0) continue;
        const total = this.catalog.grams(item.ingredientId, item.quantityValue, item.quantityUnit);
        if (!total) continue;
        const left = (total * item.remainingPct) / 100;
        const take = Math.min(left, need);
        need -= take;
        const pct = Math.max(0, Math.round(((left - take) / total) * 100));
        item.remainingPct = pct;
        const existing = updates.find((x) => x.itemId === item.id);
        if (existing) existing.remainingPct = pct;
        else updates.push({ itemId: item.id, ingredientId: item.ingredientId, label: this.catalog.label(item.ingredientId), remainingPct: pct, removed: pct === 0 });
      }
    }
    for (const c of corrections) {
      const item = items.find((i) => i.id === c.itemId);
      if (!item) continue;
      const existing = updates.find((x) => x.itemId === c.itemId);
      if (existing) existing.remainingPct = c.remainingPct;
      else updates.push({ itemId: c.itemId, ingredientId: item.ingredientId, label: this.catalog.label(item.ingredientId), remainingPct: c.remainingPct, removed: false });
    }
    for (const up of updates) {
      up.removed = up.remainingPct === 0;
      if (up.removed) await this.repo.delete(exec, userId, up.itemId);
      else await this.repo.update(exec, userId, up.itemId, { remainingPct: up.remainingPct });
    }
    if (updates.length) {
      await this.outbox.record(exec, 'pantry.items_consumed', {
        userId,
        sessionId,
        updates: updates.map(({ itemId, ingredientId, remainingPct, removed }) => ({ itemId, ingredientId, remainingPct, removed })),
      });
    }
    return updates.map(({ itemId, label, remainingPct, removed }) => ({ itemId, label, remainingPct, removed }));
  }

  /** Deshace un ítem que entró por una línea de factura («Tu factura» → toggle apagado). */
  async removeByReceiptItem(exec: Executor, userId: string, receiptItemId: string) {
    const rows = await this.repo.deleteByReceiptItem(exec, userId, receiptItemId);
    for (const r of rows) {
      await this.outbox.record(exec, 'pantry.item_removed', { userId, itemId: r.id, ingredientId: r.ingredientId, addToShoppingList: false });
    }
    return rows.length;
  }

  availableIngredientIds(userId: string) {
    return this.repo.availableIngredientIds(userId);
  }
}
