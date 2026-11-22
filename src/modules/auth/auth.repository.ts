import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { follows, oauthIdentities, refreshTokens, users } from '../../infrastructure/database/postgres/schema.js';

export type UserRow = typeof users.$inferSelect;

export class UsersRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string, exec: Executor = this.db) {
    const [row] = await exec.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async findManyByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.id, ids));
  }

  async findByEmail(email: string, exec: Executor = this.db) {
    const [row] = await exec.select().from(users).where(eq(users.email, email.toLowerCase()));
    return row ?? null;
  }

  async create(exec: Executor, row: typeof users.$inferInsert) {
    const [created] = await exec.insert(users).values(row).returning();
    return created!;
  }

  async update(exec: Executor, id: string, patch: Partial<typeof users.$inferInsert>) {
    const [row] = await exec.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return row ?? null;
  }

  async onboardingStatus(id: string): Promise<string | null> {
    const [row] = await this.db.select({ s: users.onboardingStatus }).from(users).where(eq(users.id, id));
    return row?.s ?? null;
  }

  async findIdentity(provider: string, subject: string) {
    const [row] = await this.db.select().from(oauthIdentities).where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, subject)));
    return row ?? null;
  }

  async linkIdentity(exec: Executor, row: typeof oauthIdentities.$inferInsert) {
    await exec.insert(oauthIdentities).values(row).onConflictDoNothing();
  }

  async insertRefreshToken(exec: Executor, row: typeof refreshTokens.$inferInsert) {
    await exec.insert(refreshTokens).values(row);
  }

  async findRefreshByHash(hash: string) {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
    return row ?? null;
  }

  /** Marca el token como usado solo si nadie lo usó antes (evita carreras al rotar). */
  async markRefreshUsed(exec: Executor, id: string): Promise<boolean> {
    const rows = await exec
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.usedAt), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  async revokeFamily(familyId: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async follow(followerId: string, followeeId: string) {
    await this.db.insert(follows).values({ followerId, followeeId }).onConflictDoNothing();
  }

  async unfollow(followerId: string, followeeId: string) {
    await this.db.delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)));
  }

  async followeeIds(followerId: string) {
    const rows = await this.db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, followerId));
    return rows.map((r) => r.id);
  }
}
