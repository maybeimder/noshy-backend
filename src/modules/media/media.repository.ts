import { and, eq } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { media } from '../../infrastructure/database/postgres/schema.js';

export type MediaRow = typeof media.$inferSelect;

export class MediaRepository {
  constructor(private readonly db: Db) {}

  async insert(row: typeof media.$inferInsert) {
    const [r] = await this.db.insert(media).values(row).returning();
    return r!;
  }

  async byKey(key: string) {
    const [r] = await this.db.select().from(media).where(eq(media.storageKey, key));
    return r ?? null;
  }

  async byId(userId: string, id: string) {
    const [r] = await this.db.select().from(media).where(and(eq(media.userId, userId), eq(media.id, id)));
    return r ?? null;
  }

  async markUploaded(id: string) {
    await this.db.update(media).set({ status: 'uploaded' }).where(eq(media.id, id));
  }

  async ownedUploaded(userId: string, id: string): Promise<MediaRow | null> {
    const r = await this.byId(userId, id);
    return r && r.status !== 'pending' ? r : null;
  }

  async attach(exec: Executor, id: string) {
    await exec.update(media).set({ status: 'attached' }).where(eq(media.id, id));
  }
}
