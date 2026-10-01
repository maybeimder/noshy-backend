import { randomUUID } from 'node:crypto';
import type { FeedbackEntry, FeedbackInput } from './feedback.model';

const feedbackByUserId = new Map<string, FeedbackEntry[]>();

export function createFeedback(userId: string, input: FeedbackInput) {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    userId,
    targetType: input.targetType,
    targetId: input.targetId.trim(),
    targetName: input.targetName.trim(),
    rating: Number(input.rating),
    note: input.note?.trim(),
    createdAt: new Date().toISOString()
  };

  const current = feedbackByUserId.get(userId) ?? [];
  current.push(entry);
  feedbackByUserId.set(userId, current);

  return entry;
}

export function listRecommendations(userId: string) {
  const current = feedbackByUserId.get(userId) ?? [];

  return [...current]
    .filter((entry) => entry.rating >= 4)
    .sort((left, right) => right.rating - left.rating)
    .map((entry) => ({
      id: entry.id,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      rating: entry.rating,
      note: entry.note ?? 'Sin observaciones.',
      recommendation: entry.rating >= 5 ? 'Recomiendo repetir esta opción.' : 'Te ha gustado bastante recientemente.'
    }));
}
