import { randomUUID } from 'node:crypto';
import type { Tx } from '../../core/persistence/unit-of-work';
import { db } from '../../infrastructure/persistence/persistence';
import { listInventoryItems } from '../inventory/inventory.service';
import { getActiveNutritionPlan } from '../plans/plan.service';
import type { ChefSession, ChefSessionMessage, CloseChefSessionInput } from './chef-session.model';
import {
  ChefMessageRecordedEvent,
  ChefSessionClosedEvent,
  ChefSessionOpenedEvent,
  ChefSessionRecoveryRequiredEvent
} from './events/chef-session.events';

const notActive = { ok: false, code: 'CHEF_SESSION_NOT_ACTIVE', message: 'La sesión del agente no está activa.' } as const;

export async function getActiveChefSession(userId: string, sessionId: string, tx?: Tx) {
  const session = await db().chefSessions.findById(sessionId, tx);
  return session?.userId === userId && session.status === 'active' ? session : null;
}

export async function openChefSession(userId: string) {
  return db().uow.transaction(async (tx) => {
    const preferences = await db().preferences.getByUserId(userId, tx);
    const session: ChefSession = {
      id: randomUUID(),
      userId,
      status: 'active',
      basePreferencesVersion: preferences.version,
      preferencesVersion: preferences.version,
      preferencesMarkdown: preferences.content,
      startedAt: new Date().toISOString()
    };

    await db().chefSessions.insert(session, tx);
    await db().events.append([new ChefSessionOpenedEvent({ userId, sessionId: session.id, preferencesVersion: session.preferencesVersion })], tx);
    return session;
  });
}

export function addChefSessionMessage(userId: string, sessionId: string, content: string) {
  return addSessionMessage(userId, sessionId, 'user', content);
}

export function addChefAssistantMessage(userId: string, sessionId: string, content: string) {
  return addSessionMessage(userId, sessionId, 'assistant', content);
}

async function addSessionMessage(userId: string, sessionId: string, role: ChefSessionMessage['role'], content: string) {
  return db().uow.transaction(async (tx) => {
    if (!(await getActiveChefSession(userId, sessionId, tx))) {
      return notActive;
    }

    const message: ChefSessionMessage = {
      id: randomUUID(),
      sessionId,
      userId,
      role,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };
    await db().chefSessions.insertMessage(message, tx);
    await db().events.append([new ChefMessageRecordedEvent({ userId, sessionId, messageId: message.id, role })], tx);

    return { ok: true, data: message } as const;
  });
}

export async function getChefSessionContext(userId: string, sessionId: string) {
  const session = await getActiveChefSession(userId, sessionId);
  if (!session) {
    return notActive;
  }

  const [nutritionPlan, inventory, messages] = await Promise.all([
    getActiveNutritionPlan(userId),
    listInventoryItems(userId),
    db().chefSessions.listMessages(sessionId)
  ]);

  return {
    ok: true,
    data: {
      sessionId: session.id,
      userId: session.userId,
      preferencesMarkdown: session.preferencesMarkdown,
      preferencesVersion: session.preferencesVersion,
      nutritionPlan: nutritionPlan ?? undefined,
      inventory,
      messages
    }
  } as const;
}

export async function closeChefSession(userId: string, sessionId: string, input: CloseChefSessionInput) {
  return db().uow.transaction(async (tx) => {
    const session = await db().chefSessions.findById(sessionId, tx);

    if (!session || session.userId !== userId) {
      return { ok: false, code: 'CHEF_SESSION_NOT_FOUND', message: 'No existe la sesión solicitada.' } as const;
    }

    if (session.status !== 'active') {
      return { ok: false, code: 'CHEF_SESSION_NOT_ACTIVE', message: 'La sesión no está activa.' } as const;
    }

    const preferences = await db().preferences.saveIfVersionMatches(userId, input.preferencesMarkdown, session.basePreferencesVersion, tx);

    if (!preferences) {
      // Se confirma a propósito: la sesión queda en recovery_pending y el hecho queda registrado.
      const pending: ChefSession = { ...session, status: 'recovery_pending' };
      await db().chefSessions.update(pending, tx);
      await db().events.append([new ChefSessionRecoveryRequiredEvent({ userId, sessionId })], tx);
      return { ok: false, code: 'PREFERENCES_VERSION_CONFLICT', data: pending } as const;
    }

    const closed: ChefSession = {
      ...session,
      status: 'closed',
      preferencesVersion: preferences.version,
      preferencesMarkdown: preferences.content,
      closedAt: new Date().toISOString(),
      closeReason: input.reason
    };
    await db().chefSessions.update(closed, tx);
    await db().events.append(
      [new ChefSessionClosedEvent({ userId, sessionId, reason: input.reason, preferencesVersion: closed.preferencesVersion })],
      tx
    );

    return { ok: true, data: closed } as const;
  });
}
