export type ChefSessionStatus = 'active' | 'closed' | 'recovery_pending';
export type ChefSessionCloseReason = 'manual' | 'timeout' | 'error';
export type ChefSessionMessageRole = 'user' | 'assistant';

export interface PreferencesDocument {
  userId: string;
  content: string;
  version: number;
  updatedAt: string;
}

export interface ChefSession {
  id: string;
  userId: string;
  status: ChefSessionStatus;
  basePreferencesVersion: number;
  preferencesVersion: number;
  preferencesMarkdown: string;
  startedAt: string;
  closedAt?: string;
  closeReason?: ChefSessionCloseReason;
}

export interface CloseChefSessionInput {
  reason: ChefSessionCloseReason;
  preferencesMarkdown: string;
}

export interface ChefSessionMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: ChefSessionMessageRole;
  content: string;
  createdAt: string;
}
