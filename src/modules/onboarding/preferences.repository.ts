import { eq } from 'drizzle-orm';
import type { Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { onboardingDrafts, userPreferences } from '../../infrastructure/database/postgres/schema.js';

export type PreferencesRow = typeof userPreferences.$inferSelect;

export class PreferencesRepository {
  constructor(private readonly db: Executor) {}

  async get(userId: string, exec: Executor = this.db): Promise<PreferencesRow | null> {
    const [row] = await exec.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    return row ?? null;
  }

  async upsert(exec: Executor, row: typeof userPreferences.$inferInsert) {
    await exec
      .insert(userPreferences)
      .values(row)
      .onConflictDoUpdate({ target: userPreferences.userId, set: { ...row, updatedAt: new Date() } });
  }

  async update(exec: Executor, userId: string, patch: Partial<typeof userPreferences.$inferInsert>) {
    const [row] = await exec.update(userPreferences).set({ ...patch, updatedAt: new Date() }).where(eq(userPreferences.userId, userId)).returning();
    return row ?? null;
  }

  async getDraft(userId: string) {
    const [row] = await this.db.select().from(onboardingDrafts).where(eq(onboardingDrafts.userId, userId));
    return row ?? null;
  }

  async upsertDraft(exec: Executor, row: typeof onboardingDrafts.$inferInsert) {
    await exec
      .insert(onboardingDrafts)
      .values(row)
      .onConflictDoUpdate({ target: onboardingDrafts.userId, set: { currentStep: row.currentStep, skippedSteps: row.skippedSteps, draft: row.draft, updatedAt: new Date() } });
  }
}
