import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { menuEntries, menus } from '../../infrastructure/database/postgres/schema.js';

export type MenuRow = typeof menus.$inferSelect;

export class MenusRepository {
  constructor(private readonly db: Db) {}

  async create(exec: Executor, row: typeof menus.$inferInsert) {
    const [r] = await exec.insert(menus).values(row).returning();
    return r!;
  }

  async byId(userId: string, id: string) {
    const [r] = await this.db.select().from(menus).where(and(eq(menus.userId, userId), eq(menus.id, id)));
    return r ?? null;
  }

  async update(exec: Executor, id: string, patch: Partial<typeof menus.$inferInsert>) {
    await exec.update(menus).set(patch).where(eq(menus.id, id));
  }

  async entries(menuId: string) {
    return this.db.select().from(menuEntries).where(eq(menuEntries.menuId, menuId)).orderBy(menuEntries.localDate);
  }

  async insertEntries(exec: Executor, rows: (typeof menuEntries.$inferInsert)[]) {
    if (rows.length) await exec.insert(menuEntries).values(rows);
  }

  async latest(userId: string, exec: Executor = this.db) {
    const [r] = await exec.select().from(menus).where(eq(menus.userId, userId)).orderBy(desc(menus.weekStart), desc(menus.createdAt)).limit(1);
    return r ?? null;
  }

  /** Una sola petición a la vez abre la semana de una persona. Se suelta al terminar la transacción. */
  async lockUser(tx: Executor, userId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`menu:${userId}`}))`);
  }

  /** Estado actual con la fila bloqueada: dos generaciones a la vez no insertan dos veces. */
  async statusForUpdate(tx: Executor, menuId: string) {
    const [r] = await tx.select({ status: menus.status }).from(menus).where(eq(menus.id, menuId)).for('update');
    return r?.status ?? null;
  }

  /** Recetas del menú anterior a este. */
  async recentRecipeIds(userId: string, menuId: string) {
    const [previous] = await this.db.select({ id: menus.id }).from(menus).where(and(eq(menus.userId, userId), ne(menus.id, menuId))).orderBy(desc(menus.weekStart), desc(menus.createdAt)).limit(1);
    if (!previous) return [];
    const rows = await this.db.select({ id: menuEntries.recipeId }).from(menuEntries).where(eq(menuEntries.menuId, previous.id));
    return rows.map((r) => r.id);
  }

  /** Lo que la persona ya había puesto desde `from` pasa al menú nuevo. */
  async moveEntries(exec: Executor, fromMenuId: string, toMenuId: string, from: string) {
    await exec.update(menuEntries).set({ menuId: toMenuId }).where(and(eq(menuEntries.menuId, fromMenuId), gte(menuEntries.localDate, from)));
  }

  async deleteEntriesFrom(exec: Executor, menuId: string, from: string) {
    return exec.delete(menuEntries).where(and(eq(menuEntries.menuId, menuId), gte(menuEntries.localDate, from))).returning();
  }

  async entry(menuId: string, entryId: string) {
    const [r] = await this.db.select().from(menuEntries).where(and(eq(menuEntries.menuId, menuId), eq(menuEntries.id, entryId)));
    return r ?? null;
  }

  async updateEntry(exec: Executor, entryId: string, patch: Partial<typeof menuEntries.$inferInsert>) {
    const [r] = await exec.update(menuEntries).set(patch).where(eq(menuEntries.id, entryId)).returning();
    return r!;
  }

  async deleteEntry(exec: Executor, entryId: string) {
    await exec.delete(menuEntries).where(eq(menuEntries.id, entryId));
  }
}
