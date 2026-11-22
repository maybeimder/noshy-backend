import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { shoppingListItems, shoppingListRecipes, shoppingLists } from '../../infrastructure/database/postgres/schema.js';

export type ShoppingListRow = typeof shoppingLists.$inferSelect;
export type ShoppingItemRow = typeof shoppingListItems.$inferSelect;
export type ShoppingRecipeRow = typeof shoppingListRecipes.$inferSelect;

export class ShoppingRepository {
  constructor(private readonly db: Db) {}

  async active(userId: string, exec: Executor = this.db): Promise<ShoppingListRow | null> {
    const [row] = await exec
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.status, 'active')))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1);
    return row ?? null;
  }

  async byId(userId: string, listId: string, exec: Executor = this.db): Promise<ShoppingListRow | null> {
    const [row] = await exec.select().from(shoppingLists).where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.id, listId)));
    return row ?? null;
  }

  async byShareToken(token: string) {
    const [row] = await this.db.select().from(shoppingLists).where(eq(shoppingLists.shareToken, token));
    return row ?? null;
  }

  async create(exec: Executor, row: typeof shoppingLists.$inferInsert) {
    const [r] = await exec.insert(shoppingLists).values(row).returning();
    return r!;
  }

  async update(exec: Executor, listId: string, patch: Partial<typeof shoppingLists.$inferInsert>) {
    const [r] = await exec.update(shoppingLists).set(patch).where(eq(shoppingLists.id, listId)).returning();
    return r ?? null;
  }

  async items(listId: string, exec: Executor = this.db): Promise<ShoppingItemRow[]> {
    return exec.select().from(shoppingListItems).where(eq(shoppingListItems.listId, listId)).orderBy(asc(shoppingListItems.position), asc(shoppingListItems.createdAt));
  }

  async item(listId: string, itemId: string, exec: Executor = this.db) {
    const [r] = await exec.select().from(shoppingListItems).where(and(eq(shoppingListItems.listId, listId), eq(shoppingListItems.id, itemId)));
    return r ?? null;
  }

  async insertItems(exec: Executor, rows: (typeof shoppingListItems.$inferInsert)[]) {
    if (rows.length === 0) return [];
    return exec.insert(shoppingListItems).values(rows).returning();
  }

  async updateItem(exec: Executor, itemId: string, patch: Partial<typeof shoppingListItems.$inferInsert>) {
    const [r] = await exec.update(shoppingListItems).set(patch).where(eq(shoppingListItems.id, itemId)).returning();
    return r!;
  }

  async deleteItems(exec: Executor, ids: string[]) {
    if (ids.length) await exec.delete(shoppingListItems).where(inArray(shoppingListItems.id, ids));
  }

  async recipes(listId: string, exec: Executor = this.db): Promise<ShoppingRecipeRow[]> {
    return exec.select().from(shoppingListRecipes).where(eq(shoppingListRecipes.listId, listId));
  }

  async addRecipe(exec: Executor, row: typeof shoppingListRecipes.$inferInsert): Promise<boolean> {
    const r = await exec.insert(shoppingListRecipes).values(row).onConflictDoNothing().returning();
    return r.length > 0;
  }

  /** Ingredientes pendientes de comprar en la lista activa. */
  async activeIngredientIds(userId: string): Promise<Set<string>> {
    const list = await this.active(userId);
    if (!list) return new Set();
    const rows = await this.db
      .select({ id: shoppingListItems.ingredientId })
      .from(shoppingListItems)
      .where(and(eq(shoppingListItems.listId, list.id), eq(shoppingListItems.checked, false)));
    return new Set(rows.map((r) => r.id));
  }

  async spentInWeek(userId: string, weekStart: string): Promise<number> {
    const [r] = await this.db
      .select({ total: sql<number>`coalesce(sum(${shoppingLists.spent}), 0)::int` })
      .from(shoppingLists)
      .where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.weekStart, weekStart), eq(shoppingLists.status, 'completed')));
    return r?.total ?? 0;
  }

  async removeRecipe(exec: Executor, listId: string, recipeId: string): Promise<boolean> {
    const r = await exec
      .delete(shoppingListRecipes)
      .where(and(eq(shoppingListRecipes.listId, listId), eq(shoppingListRecipes.recipeId, recipeId)))
      .returning();
    return r.length > 0;
  }
}
