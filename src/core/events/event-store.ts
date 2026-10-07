import type { DomainEvent } from './domain-event';

// Registro inmutable del Event Store (fuente de verdad).
export interface StoredEvent {
  eventId: string;
  streamId: string;
  version: number;
  type: string;
  payload: unknown;
  occurredAt: string;
}

export type OutboxStatus = 'pending' | 'dispatched' | 'dead';

// Mensaje del Transactional Outbox: una entrega pendiente por cada evento guardado.
export interface OutboxMessage {
  id: string;
  event: StoredEvent;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  dispatchedAt?: string;
}

// Event Sourcing. `append` DEBE guardar los eventos y sus mensajes de outbox de forma atómica
// (misma transacción). Con una base de datos son dos INSERT dentro de un solo BEGIN/COMMIT.
export interface EventStore {
  append(events: DomainEvent<any>[]): StoredEvent[];
  readStream(streamId: string): StoredEvent[];
  readAll(): StoredEvent[];
}

// Versión persistente (base de datos). `append` recibe la transacción del caso de uso (`tx`) para que
// el cambio de estado y el evento se confirmen juntos: ese es el Transactional Outbox real.
export interface PersistentEventStore<Tx = unknown> {
  append(events: DomainEvent<any>[], tx?: Tx): Promise<StoredEvent[]>;
  readStream(streamId: string): Promise<StoredEvent[]>;
  readAll(): Promise<StoredEvent[]>;
}

// Se lanza cuando dos escrituras compiten por la misma versión de un stream (concurrencia optimista).
export class StreamVersionConflictError extends Error {
  constructor(readonly streamId: string) {
    super(`Conflicto de versión en el stream ${streamId}`);
  }
}

// Lado de lectura del outbox, usado por el relay.
export interface Outbox {
  pending(limit?: number): Promise<OutboxMessage[]>;
  markDispatched(messageId: string): Promise<void>;
  // Suma un intento; pasa a 'dead' al llegar a maxAttempts.
  markFailed(messageId: string, error: string, maxAttempts: number): Promise<void>;
}
