import type { EventPayloads, EventType } from './catalog.js';

/**
 * Evento de dominio ya construido. Es inmutable: el `DomainEventFactory` lo congela.
 *
 * - `streamId`: el stream del event store al que pertenece. Todo evento es de un usuario, así que
 *   el stream es su `userId` (o `system` para los pocos que no tienen dueño).
 * - `version`: posición dentro de su stream (1, 2, 3…). Es 0 hasta que el event store lo guarda.
 */
export type DomainEvent<T extends EventType = EventType> = {
  readonly id: string;
  readonly type: T;
  readonly streamId: string;
  readonly version: number;
  readonly userId: string | null;
  readonly occurredAt: Date;
  readonly payload: Readonly<EventPayloads[T]>;
};

/** Evento tal como sale del event store: incluye su posición global (orden total de escritura). */
export type StoredEvent<T extends EventType = EventType> = DomainEvent<T> & { readonly position: number };

/** Forma del evento en el cable (cuerpo del mensaje de RabbitMQ). */
export type EventEnvelope = {
  schema: 'noshy.event/v1';
  eventId: string;
  type: string;
  streamId: string;
  version: number;
  userId: string | null;
  occurredAt: string;
  payload: unknown;
};

export const SYSTEM_STREAM = 'system';
