import { and, eq } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { receiptItems, receipts } from '../../infrastructure/database/postgres/schema.js';
import type { MongoCollections } from '../../infrastructure/database/mongo/collections.js';

export type ReceiptRow = typeof receipts.$inferSelect;

export class ReceiptsRepository {
  constructor(
    private readonly db: Db,
    private readonly mongo: MongoCollections,
  ) {}

  async insert(exec: Executor, row: typeof receipts.$inferInsert) {
    const [r] = await exec.insert(receipts).values(row).returning();
    return r!;
  }

  async byId(userId: string, id: string) {
    const [r] = await this.db.select().from(receipts).where(and(eq(receipts.userId, userId), eq(receipts.id, id)));
    return r ?? null;
  }

  async byIdAny(id: string) {
    const [r] = await this.db.select().from(receipts).where(eq(receipts.id, id));
    return r ?? null;
  }

  async update(exec: Executor, id: string, patch: Partial<typeof receipts.$inferInsert>) {
    await exec.update(receipts).set(patch).where(eq(receipts.id, id));
  }

  async insertItems(exec: Executor, rows: (typeof receiptItems.$inferInsert)[]) {
    if (rows.length) await exec.insert(receiptItems).values(rows);
  }

  async saveRaw(receiptId: string, userId: string, parser: string, raw: unknown) {
    await this.mongo.receiptScans.updateOne({ _id: receiptId }, { $set: { userId, parser, raw, createdAt: new Date() } }, { upsert: true });
  }

  async items(receiptId: string) {
    return this.db.select().from(receiptItems).where(eq(receiptItems.receiptId, receiptId));
  }

  async item(receiptId: string, itemId: string) {
    const [r] = await this.db.select().from(receiptItems).where(and(eq(receiptItems.receiptId, receiptId), eq(receiptItems.id, itemId)));
    return r ?? null;
  }

  async updateItem(exec: Executor, itemId: string, patch: Partial<typeof receiptItems.$inferInsert>) {
    await exec.update(receiptItems).set(patch).where(eq(receiptItems.id, itemId));
  }
}
