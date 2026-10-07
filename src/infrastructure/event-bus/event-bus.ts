import type { DomainEvent } from '../../core/events/domain-event';
import { InMemoryEventStore } from '../../core/events/in-memory-event-store';

// Event Store + Outbox compartidos por el proceso. Hoy en memoria; con base de datos
// esta es la única pieza que cambia (EventStore/Outbox respaldados por Postgres).
let currentStore = new InMemoryEventStore();

export function getEventStore(): InMemoryEventStore {
  return currentStore;
}

// Para tests: aísla cada suite con un store limpio.
export function setEventStore(store: InMemoryEventStore): void {
  currentStore = store;
}

// Lo usan los servicios justo después de una mutación exitosa. Guarda el evento y su mensaje
// de outbox juntos (Transactional Outbox); la entrega a los observers la hace el OutboxRelay.
export function publishEvent(event: DomainEvent<any>): void {
  currentStore.append([event]);
}
