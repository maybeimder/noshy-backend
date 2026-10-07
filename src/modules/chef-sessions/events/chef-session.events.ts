import { DomainEvent } from '../../../core/events/domain-event';
import type { ChefSessionCloseReason, ChefSessionMessageRole } from '../chef-session.model';

export class ChefSessionOpenedEvent extends DomainEvent<{ userId: string; sessionId: string; preferencesVersion: number }> {
  static readonly eventName = 'chef.session_opened';
}

export class ChefMessageRecordedEvent extends DomainEvent<{
  userId: string;
  sessionId: string;
  messageId: string;
  role: ChefSessionMessageRole;
}> {
  static readonly eventName = 'chef.message_recorded';
}

export class ChefSessionClosedEvent extends DomainEvent<{
  userId: string;
  sessionId: string;
  reason: ChefSessionCloseReason;
  preferencesVersion: number;
}> {
  static readonly eventName = 'chef.session_closed';
}

/** La sesión no pudo guardar preferencias por conflicto de versión y queda en recovery_pending. */
export class ChefSessionRecoveryRequiredEvent extends DomainEvent<{ userId: string; sessionId: string }> {
  static readonly eventName = 'chef.session_recovery_required';
}