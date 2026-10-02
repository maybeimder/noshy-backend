import { randomUUID } from 'node:crypto';
import { getActiveChefSession } from '../chef-sessions/chef-session.service';
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

  if (!getActiveChefSession(userId, input.sessionId)) {
    return {
      ok: false,
      code: 'CHEF_SESSION_NOT_ACTIVE',
      message: 'La sesión del agente no está activa.'
    } as const;
  }

  const entry: FeedbackEntry = {
    id: randomUUID(),
    userId,
    sessionId: input.sessionId,
    targetType: input.targetType,
    targetId: input.targetId.trim(),
    targetName: input.targetName.trim(),
    eventType: input.eventType,
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
  const positiveEvents = new Set(['selected', 'prepared', 'repeated']);

  return [...current]
    .filter((entry) => positiveEvents.has(entry.eventType))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((entry) => ({
      id: entry.id,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      eventType: entry.eventType,
      note: entry.note ?? 'Sin observaciones.',
      recommendation: entry.eventType === 'repeated'
        ? 'Esta opción se ha repetido y puede volver a recomendarse.'
        : 'Esta opción mostró una señal positiva recientemente.'
    }));
}
