import { randomUUID } from 'node:crypto';
import type { ChefSession, ChefSessionMessage, CloseChefSessionInput } from './chef-session.model';
import { InMemoryPreferencesRepository, type PreferencesRepository } from './preferences.repository';

const sessions = new Map<string, ChefSession>();
const messagesBySessionId = new Map<string, ChefSessionMessage[]>();
const preferencesRepository: PreferencesRepository = new InMemoryPreferencesRepository();

export function getActiveChefSession(userId: string, sessionId: string) {
  const session = sessions.get(sessionId);
  return session?.userId === userId && session.status === 'active' ? session : null;
}

export function openChefSession(userId: string) {
  const preferences = preferencesRepository.getByUserId(userId);
  const session: ChefSession = {
    id: randomUUID(),
    userId,
    status: 'active',
    basePreferencesVersion: preferences.version,
    preferencesVersion: preferences.version,
    preferencesMarkdown: preferences.content,
    startedAt: new Date().toISOString()
  };

  sessions.set(session.id, session);
  messagesBySessionId.set(session.id, []);
  return session;
}

export function addChefSessionMessage(userId: string, sessionId: string, content: string) {
  const session = getActiveChefSession(userId, sessionId);
  if (!session) {
    return { ok: false, code: 'CHEF_SESSION_NOT_ACTIVE', message: 'La sesión del agente no está activa.' } as const;
  }

  const message: ChefSessionMessage = {
    id: randomUUID(),
    sessionId,
    userId,
    role: 'user',
    content: content.trim(),
    createdAt: new Date().toISOString()
  };
  const messages = messagesBySessionId.get(sessionId) ?? [];
  messages.push(message);
  messagesBySessionId.set(sessionId, messages);

  return { ok: true, data: message } as const;
}

export function getChefSessionContext(userId: string, sessionId: string) {
  const session = getActiveChefSession(userId, sessionId);
  if (!session) {
    return { ok: false, code: 'CHEF_SESSION_NOT_ACTIVE', message: 'La sesión del agente no está activa.' } as const;
  }

  return {
    ok: true,
    data: {
      sessionId: session.id,
      preferencesMarkdown: session.preferencesMarkdown,
      preferencesVersion: session.preferencesVersion,
      messages: messagesBySessionId.get(sessionId) ?? []
    }
  } as const;
}

export function closeChefSession(userId: string, sessionId: string, input: CloseChefSessionInput) {
  const session = sessions.get(sessionId);

  if (!session || session.userId !== userId) {
    return { ok: false, code: 'CHEF_SESSION_NOT_FOUND', message: 'No existe la sesión solicitada.' } as const;
  }

  if (session.status !== 'active') {
    return { ok: false, code: 'CHEF_SESSION_NOT_ACTIVE', message: 'La sesión no está activa.' } as const;
  }

  const preferences = preferencesRepository.saveIfVersionMatches(
    userId,
    input.preferencesMarkdown,
    session.basePreferencesVersion
  );

  if (!preferences) {
    session.status = 'recovery_pending';
    return { ok: false, code: 'PREFERENCES_VERSION_CONFLICT', data: session } as const;
  }

  session.status = 'closed';
  session.preferencesVersion = preferences.version;
  session.preferencesMarkdown = preferences.content;
  session.closedAt = new Date().toISOString();
  session.closeReason = input.reason;

  return { ok: true, data: session } as const;
}
