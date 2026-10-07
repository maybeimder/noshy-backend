import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/persistence/persistence';
import { getActiveChefSession } from '../chef-sessions/chef-session.service';
import { FeedbackRecordedEvent } from './events/feedback.events';
import type { FeedbackEntry, FeedbackInput } from './feedback.model';

export async function createFeedback(userId: string, input: FeedbackInput, idempotencyKey?: string) {
  return db().uow.transaction(async (tx) => {
    if (idempotencyKey) {
      const existing = await db().feedback.findByIdempotencyKey(userId, idempotencyKey, tx);
      if (existing) {
        return { entry: existing, duplicate: true } as const;
      }
    }

    if (!(await getActiveChefSession(userId, input.sessionId, tx))) {
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

    await db().feedback.insert(entry, tx);
    await db().events.append([new FeedbackRecordedEvent({ userId, entry })], tx);

    return { entry, duplicate: false } as const;
  });
}

export function listFeedback(userId: string) {
  return db().feedback.listByUser(userId);
}

export async function listRecommendations(userId: string) {
  const current = await db().feedback.listByUser(userId);
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
