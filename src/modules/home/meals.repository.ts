import { and, eq, gte, lte } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { mealLogs } from '../../infrastructure/database/postgres/schema.js';

export type MealLogRow = typeof mealLogs.$inferSelect;

export class MealsRepository {
  constructor(private readonly db: Db) {}

  async forDate(userId: string, localDate: string, exec: Executor = this.db): Promise<MealLogRow[]> {
    return exec.select().from(mealLogs).where(and(eq(mealLogs.userId, userId), eq(mealLogs.localDate, localDate))).orderBy(mealLogs.createdAt);
  }

  async between(userId: string, from: string, to: string): Promise<MealLogRow[]> {
    return this.db.select().from(mealLogs).where(and(eq(mealLogs.userId, userId), gte(mealLogs.localDate, from), lte(mealLogs.localDate, to))).orderBy(mealLogs.createdAt);
  }

  async insert(exec: Executor, row: typeof mealLogs.$inferInsert) {
    const [r] = await exec.insert(mealLogs).values(row).returning();
    return r!;
  }

  async delete(exec: Executor, userId: string, localDate: string, id: string) {
    const [r] = await exec.delete(mealLogs).where(and(eq(mealLogs.userId, userId), eq(mealLogs.localDate, localDate), eq(mealLogs.id, id))).returning();
    return r ?? null;
  }
}
