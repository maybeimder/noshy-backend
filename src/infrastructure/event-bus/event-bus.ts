import { InMemoryEventStore } from '../../core/events/in-memory-event-store';

// Event Store + Outbox en memoria (modo sin DATABASE_URL). Con Postgres los servicios escriben en
// PostgresEventStore a través de db().events, dentro de la transacción del caso de uso.
let currentStore = new InMemoryEventStore();

export function getEventStore(): InMemoryEventStore {
  return currentStore;
}

// Para tests: aísla cada suite con un store limpio.
export function setEventStore(store: InMemoryEventStore): void {
  currentStore = store;
}
