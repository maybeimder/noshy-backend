import { randomUUID } from 'node:crypto';
import type { FeedbackEntry, FeedbackInput } from './feedback.model';

const feedbackByUserId = new Map<string, FeedbackEntry[]>();
const feedbackByIdempotencyKey = new Map<string, Map<string, FeedbackEntry>>();

export function createFeedback(userId: string, input: FeedbackInput, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing = feedbackByIdempotencyKey.get(userId)?.get(idempotencyKey);
    if (existing) {
      return { entry: existing, duplicate: true } as const;
    }
  }

  const entry: FeedbackEntry = {
    id: randomUUID(),
    userId,
    targetType: input.targetType,
    targetId: input.targetId.trim(),
    targetName: input.targetName.trim(),
    eventType: input.eventType ?? 'rated',
    rating: input.rating === undefined ? undefined : Number(input.rating),
    note: input.note?.trim(),
    idempotencyKey,
    createdAt: new Date().toISOString()
  };

  const current = feedbackByUserId.get(userId) ?? [];
  current.push(entry);
  feedbackByUserId.set(userId, current);

  if (idempotencyKey) {
    const keys = feedbackByIdempotencyKey.get(userId) ?? new Map<string, FeedbackEntry>();
    keys.set(idempotencyKey, entry);
    feedbackByIdempotencyKey.set(userId, keys);
  }

  return { entry, duplicate: false } as const;
}

export function listFeedback(userId: string) {
  return feedbackByUserId.get(userId) ?? [];
}

export function listRecommendations(userId: string) {
  const current = feedbackByUserId.get(userId) ?? [];

  return [...current]
    .filter((entry) => entry.rating !== undefined && entry.rating >= 4)
    .sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0))
    .map((entry) => ({
      id: entry.id,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      rating: entry.rating,
      note: entry.note ?? 'Sin observaciones.',
      recommendation: (entry.rating ?? 0) >= 5 ? 'Recomiendo repetir esta opción.' : 'Te ha gustado bastante recientemente.'
    }));
}
