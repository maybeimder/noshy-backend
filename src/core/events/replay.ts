import type { DomainEventFactory } from './domain-event.factory';
import type { EventStore } from './event-store';
import type { Observer } from './observer';

// Event Sourcing: reconstruye proyecciones (observers) reproduciendo el historial del store.
// Sin streamId reproduce todos los usuarios, en el orden en que se guardaron.
export async function replayEvents(
  store: EventStore,
  factory: DomainEventFactory,
  observers: Observer[],
  streamId?: string
): Promise<number> {
  const records = streamId === undefined ? store.readAll() : store.readStream(streamId);
  for (const record of records) {
    const event = factory.create(record);
    for (const observer of observers) {
      await observer.update(event, event.userId);
    }
  }
  return records.length;
}
