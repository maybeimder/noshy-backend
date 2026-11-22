import { and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { ingredients, pantryItems, products } from '../../infrastructure/database/postgres/schema.js';
import type { Cursor } from '../../core/shared/cursor.js';

export type PantryRow = typeof pantryItems.$inferSelect;
export type PantryListRow = PantryRow & { label: string; icon: string; categoryId: string; brand: string | null; packLabel: string | null };

/** Por debajo de este nivel un ingrediente no cuenta como «lo tienes». */
export const PANTRY_MIN_PCT = 10;

export class PantryRepository {
  constructor(private readonly db: Db) {}

  private listSelect() {
    return {
      item: pantryItems,
      label: ingredients.label,
      icon: ingredients.icon,
      categoryId: ingredients.categoryId,
      brand: products.brand,
      packLabel: products.packLabel,
    };
  }

  async list(
    userId: string,
    opts: { storage?: string; q?: string; sort: 'recent' | 'expiresOn' | 'name'; limit: number; cursor: Cursor | null },
  ): Promise<PantryListRow[]> {
    const where: SQL[] = [eq(pantryItems.userId, userId)];
    if (opts.storage) where.push(eq(pantryItems.storage, opts.storage));
    if (opts.q) where.push(ilike(ingredients.label, `%${opts.q}%`));
    const c = opts.cursor;
    let order: SQL[];
    if (opts.sort === 'name') {
      if (c) where.push(or(gt(ingredients.label, String(c.k)), and(eq(ingredients.label, String(c.k)), gt(pantryItems.id, c.id)))!);
      order = [asc(ingredients.label), asc(pantryItems.id)];
    } else if (opts.sort === 'expiresOn') {
      const key = sql`coalesce(${pantryItems.expiresOn}, '9999-12-31'::date)`;
      if (c) where.push(sql`(${key}, ${pantryItems.id}) > (${String(c.k)}::date, ${c.id})`);
      order = [asc(key), asc(pantryItems.id)];
    } else {
      if (c) where.push(sql`(${pantryItems.addedAt}, ${pantryItems.id}) < (${String(c.k)}::timestamptz, ${c.id})`);
      order = [desc(pantryItems.addedAt), desc(pantryItems.id)];
    }
    const rows = await this.db
      .select(this.listSelect())
      .from(pantryItems)
      .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
      .leftJoin(products, eq(products.id, pantryItems.productId))
      .where(and(...where))
      .orderBy(...order)
      .limit(opts.limit + 1);
    return rows.map((r) => ({ ...r.item, label: r.label, icon: r.icon, categoryId: r.categoryId, brand: r.brand, packLabel: r.packLabel }));
  }

  async byId(userId: string, id: string, exec: Executor = this.db): Promise<PantryListRow | null> {
    const [r] = await exec
      .select(this.listSelect())
      .from(pantryItems)
      .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
      .leftJoin(products, eq(products.id, pantryItems.productId))
      .where(and(eq(pantryItems.userId, userId), eq(pantryItems.id, id)));
    return r ? { ...r.item, label: r.label, icon: r.icon, categoryId: r.categoryId, brand: r.brand, packLabel: r.packLabel } : null;
  }

  async byIngredients(userId: string, ingredientIds: string[], exec: Executor = this.db): Promise<PantryRow[]> {
    if (ingredientIds.length === 0) return [];
    return exec
      .select()
      .from(pantryItems)
      .where(and(eq(pantryItems.userId, userId), inArray(pantryItems.ingredientId, ingredientIds)))
      .orderBy(asc(pantryItems.expiresOn));
  }

  /** IDs de ingredientes que el usuario tiene con nivel suficiente (o desconocido). */
  async availableIngredientIds(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ id: pantryItems.ingredientId })
      .from(pantryItems)
      .where(and(eq(pantryItems.userId, userId), or(isNull(pantryItems.remainingPct), gt(pantryItems.remainingPct, PANTRY_MIN_PCT))));
    return new Set(rows.map((r) => r.id));
  }

  async insertMany(exec: Executor, rows: (typeof pantryItems.$inferInsert)[]) {
    if (rows.length === 0) return [];
    return exec.insert(pantryItems).values(rows).returning();
  }

  async update(exec: Executor, userId: string, id: string, patch: Partial<typeof pantryItems.$inferInsert>) {
    const [r] = await exec
      .update(pantryItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(pantryItems.userId, userId), eq(pantryItems.id, id)))
      .returning();
    return r ?? null;
  }

  async delete(exec: Executor, userId: string, id: string) {
    const [r] = await exec.delete(pantryItems).where(and(eq(pantryItems.userId, userId), eq(pantryItems.id, id))).returning();
    return r ?? null;
  }

  async deleteByIngredientWithoutProduct(exec: Executor, userId: string, ingredientId: string) {
    return exec
      .delete(pantryItems)
      .where(and(eq(pantryItems.userId, userId), eq(pantryItems.ingredientId, ingredientId), isNull(pantryItems.productId)))
      .returning();
  }

  async storageCounts(userId: string) {
    const rows = await this.db
      .select({ storage: pantryItems.storage, n: sql<number>`count(*)::int` })
      .from(pantryItems)
      .where(eq(pantryItems.userId, userId))
      .groupBy(pantryItems.storage);
    const out = { all: 0, fridge: 0, pantry: 0, freezer: 0 };
    for (const r of rows) {
      out.all += r.n;
      if (r.storage === 'fridge' || r.storage === 'pantry' || r.storage === 'freezer') out[r.storage] += r.n;
    }
    return out;
  }

  async lastUpdatedAt(userId: string): Promise<Date | null> {
    const [r] = await this.db.select({ at: sql<string | null>`max(${pantryItems.updatedAt})` }).from(pantryItems).where(eq(pantryItems.userId, userId));
    return r?.at ? new Date(r.at) : null;
  }

  async expiringBefore(userId: string, isoDate: string, limit: number): Promise<PantryListRow[]> {
    const rows = await this.db
      .select(this.listSelect())
      .from(pantryItems)
      .innerJoin(ingredients, eq(ingredients.id, pantryItems.ingredientId))
      .leftJoin(products, eq(products.id, pantryItems.productId))
      .where(
        and(
          eq(pantryItems.userId, userId),
          lte(pantryItems.expiresOn, isoDate),
          or(isNull(pantryItems.remainingPct), gt(pantryItems.remainingPct, 0)),
        ),
      )
      .orderBy(asc(pantryItems.expiresOn))
      .limit(limit);
    return rows.map((r) => ({ ...r.item, label: r.label, icon: r.icon, categoryId: r.categoryId, brand: r.brand, packLabel: r.packLabel }));
  }

  async deleteByReceiptItem(exec: Executor, userId: string, receiptItemId: string) {
    return exec.delete(pantryItems).where(and(eq(pantryItems.userId, userId), eq(pantryItems.receiptItemId, receiptItemId))).returning();
  }
}
