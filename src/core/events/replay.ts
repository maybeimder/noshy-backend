import type { DomainEventFactory } from './domain-event.factory';
import type { EventStore, PersistentEventStore } from './event-store';
import type { Observer } from './observer';

// Event Sourcing: reconstruye proyecciones (observers) reproduciendo el historial del store.
// Sin streamId reproduce todos los usuarios, en el orden en que se guardaron.
// Acepta el store en memoria o el persistente (Postgres).
export async function replayEvents(
  store: EventStore | PersistentEventStore,
  factory: DomainEventFactory,
  observers: Observer[],
  streamId?: string
): Promise<number> {
  const records = await (streamId === undefined ? store.readAll() : store.readStream(streamId));
  for (const record of records) {
    const event = factory.create(record);
    for (const observer of observers) {
      await observer.update(event, event.userId);
    }
  }
  return records.length;
}
