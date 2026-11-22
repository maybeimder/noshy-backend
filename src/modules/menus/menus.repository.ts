import { and, desc, eq } from 'drizzle-orm';
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

  async latest(userId: string) {
    const [r] = await this.db.select().from(menus).where(eq(menus.userId, userId)).orderBy(desc(menus.weekStart), desc(menus.createdAt)).limit(1);
    return r ?? null;
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
