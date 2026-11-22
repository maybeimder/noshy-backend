import type { MongoCollections, ChefContext, ChefMessageDoc, ChefThreadDoc, InsightDoc, UserSignalDoc } from '../../infrastructure/database/mongo/collections.js';
import { newId } from '../../core/shared/ids.js';

/** Conversaciones del chef, señales de aprendizaje e insights (Mongo). */
export class ChefRepository {
  constructor(private readonly c: MongoCollections) {}

  // ---------- Hilos ----------
  async getOrCreateThread(userId: string, context: ChefContext): Promise<{ thread: ChefThreadDoc; created: boolean }> {
    const contextKey = context.type === 'main' ? 'main' : `recipe:${context.recipeId}`;
    const existing = await this.c.chefThreads.findOne({ userId, contextKey });
    if (existing) return { thread: existing, created: false };
    const doc: ChefThreadDoc = { _id: newId('thread'), userId, contextKey, context, lastMessageAt: null, lastReadAt: null, createdAt: new Date() };
    try {
      await this.c.chefThreads.insertOne(doc);
      return { thread: doc, created: true };
    } catch {
      // Carrera con otra petición que lo creó al mismo tiempo.
      const again = await this.c.chefThreads.findOne({ userId, contextKey });
      if (!again) throw new Error('No se pudo crear el hilo');
      return { thread: again, created: false };
    }
  }

  async thread(userId: string, threadId: string): Promise<ChefThreadDoc | null> {
    if (threadId === 'main') return (await this.getOrCreateThread(userId, { type: 'main' })).thread;
    return this.c.chefThreads.findOne({ _id: threadId, userId });
  }

  async threadIdForRecipe(userId: string, recipeId: string): Promise<string | null> {
    const t = await this.c.chefThreads.findOne({ userId, contextKey: `recipe:${recipeId}` }, { projection: { _id: 1 } });
    return t?._id ?? null;
  }

  async unreadCount(thread: ChefThreadDoc): Promise<number> {
    return this.c.chefMessages.countDocuments({
      threadId: thread._id,
      role: 'chef',
      ...(thread.lastReadAt ? { createdAt: { $gt: thread.lastReadAt } } : {}),
    });
  }

  async markRead(userId: string, threadId: string, at: Date) {
    await this.c.chefThreads.updateOne({ _id: threadId, userId, $or: [{ lastReadAt: null }, { lastReadAt: { $lt: at } }] }, { $set: { lastReadAt: at } });
  }

  // ---------- Mensajes ----------
  async messages(threadId: string, limit: number, before: { at: Date; id: string } | null) {
    const filter = before
      ? { threadId, $or: [{ createdAt: { $lt: before.at } }, { createdAt: before.at, _id: { $lt: before.id } }] }
      : { threadId };
    return this.c.chefMessages.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  }

  async message(userId: string, messageId: string) {
    return this.c.chefMessages.findOne({ _id: messageId, userId });
  }

  async byClientMessageId(userId: string, clientMessageId: string) {
    return this.c.chefMessages.findOne({ userId, clientMessageId });
  }

  async insertMessage(doc: ChefMessageDoc) {
    await this.c.chefMessages.insertOne(doc);
    await this.c.chefThreads.updateOne({ _id: doc.threadId }, { $set: { lastMessageAt: doc.createdAt } });
  }

  async updateMessage(id: string, patch: Partial<ChefMessageDoc>) {
    await this.c.chefMessages.updateOne({ _id: id }, { $set: patch });
  }

  async setFeedback(messageId: string, blockId: string, rating: 'up' | 'down') {
    await this.c.chefMessages.updateOne({ _id: messageId }, { $set: { [`feedback.${blockId}`]: rating } });
  }

  /** Recetas ya mostradas en un hilo, para que «Otra idea» no repita. */
  async shownRecipeIds(threadId: string): Promise<string[]> {
    const docs = await this.c.chefMessages.find({ threadId, role: 'chef', recipeIds: { $exists: true } }, { projection: { recipeIds: 1 } }).toArray();
    return docs.flatMap((d) => d.recipeIds ?? []);
  }

  async lastChefMessage(threadId: string) {
    return this.c.chefMessages.find({ threadId, role: 'chef' }).sort({ createdAt: -1 }).limit(1).next();
  }

  // ---------- Señales e insights ----------
  async addSignal(doc: UserSignalDoc) {
    const exists = await this.c.userSignals.findOne({ eventId: doc.eventId, kind: doc.kind, brand: doc.brand, recipeId: doc.recipeId });
    if (!exists) await this.c.userSignals.insertOne(doc);
  }

  async signals(userId: string, since: Date) {
    return this.c.userSignals.find({ userId, at: { $gte: since } }).toArray();
  }

  async signalsCount(userId: string) {
    return this.c.userSignals.countDocuments({ userId });
  }

  async insights(userId: string, limit: number, skip = 0) {
    return this.c.insights.find({ userId, status: 'active' }).sort({ confidence: -1, _id: 1 }).skip(skip).limit(limit + 1).toArray();
  }

  async insight(userId: string, id: string) {
    return this.c.insights.findOne({ _id: id, userId });
  }

  async upsertInsight(doc: Omit<InsightDoc, '_id' | 'userVote' | 'status'>) {
    await this.c.insights.updateOne(
      { userId: doc.userId, key: doc.key },
      {
        $set: { text: doc.text, confidence: doc.confidence, evidence: doc.evidence, updatedAt: doc.updatedAt },
        $setOnInsert: { _id: newId('insight'), userVote: null, status: 'active' },
      },
      { upsert: true },
    );
  }

  async voteInsight(userId: string, id: string, vote: 'up' | 'down') {
    await this.c.insights.updateOne({ _id: id, userId }, { $set: { userVote: vote, status: vote === 'down' ? 'rejected' : 'active' } });
    return this.c.insights.findOne({ _id: id, userId });
  }

  async rejectedInsightKeys(userId: string) {
    const docs = await this.c.insights.find({ userId, status: 'rejected' }, { projection: { key: 1 } }).toArray();
    return new Set(docs.map((d) => d.key));
  }
}
