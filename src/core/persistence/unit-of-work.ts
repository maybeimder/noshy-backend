import type { DomainEvent } from '../events/domain-event';
import type { StoredEvent } from '../events/event-store';

// Transacción opaca: en Postgres es el PoolClient de la transacción; en memoria, undefined.
// Los módulos nunca la inspeccionan: solo la pasan a sus repositorios y al EventAppender.
export type Tx = unknown;

// Ejecuta un caso de uso de forma atómica: todo lo escrito con el mismo `tx` se confirma o se descarta junto.
export interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

// Escribe eventos en el Event Store (+ Outbox) dentro de la transacción del caso de uso.
// readStream: lado de lectura, para proyecciones que se reconstruyen desde los eventos de un usuario.
export interface EventAppender {
  append(events: DomainEvent<any>[], tx?: Tx): Promise<void>;
  readStream(streamId: string): Promise<StoredEvent[]>;
}

// En memoria no hay rollback: el trabajo se ejecuta tal cual. La atomicidad real la da Postgres.
export class InMemoryUnitOfWork implements UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}
