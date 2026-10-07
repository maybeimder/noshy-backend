import type { Tx } from '../../core/persistence/unit-of-work';
import type { FeedbackEntry } from './feedback.model';

export interface FeedbackRepository {
  listByUser(userId: string, tx?: Tx): Promise<FeedbackEntry[]>;
  findByIdempotencyKey(userId: string, idempotencyKey: string, tx?: Tx): Promise<FeedbackEntry | null>;
  insert(entry: FeedbackEntry, tx?: Tx): Promise<void>;
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly byUser = new Map<string, FeedbackEntry[]>();

  async listByUser(userId: string) {
    return this.byUser.get(userId) ?? [];
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return (this.byUser.get(userId) ?? []).find((entry) => entry.idempotencyKey === idempotencyKey) ?? null;
  }

  async insert(entry: FeedbackEntry) {
    const entries = this.byUser.get(entry.userId) ?? [];
    entries.push(entry);
    this.byUser.set(entry.userId, entries);
  }
}
