import { EVENT_TYPES } from './catalog.js';
import type { EventStore } from './event-store.js';
import type { ReplayableObserver } from './observer.js';

export type ReplayOptions = { streamId?: string; reset?: boolean; batchSize?: number; onProgress?: (done: number) => void };

/**
 * Event Sourcing: reconstruye proyecciones reproduciendo el historial del event store, en el orden en que
 * se escribió. Llama a los observers directamente (sin RabbitMQ ni ledger): es una reconstrucción, no una entrega.
 * Con `reset` borra antes la proyección (de un usuario o de todos).
 */
export async function replayEvents(store: EventStore, observers: readonly ReplayableObserver[], opts: ReplayOptions = {}): Promise<number> {
  if (opts.reset) for (const o of observers) await o.reset(opts.streamId);
  const types = EVENT_TYPES.filter((t) => observers.some((o) => o.interestedIn(t)));
  let count = 0;

  const apply = async (events: Awaited<ReturnType<EventStore['readAll']>>) => {
    for (const e of events) {
      for (const o of observers) if (o.interestedIn(e.type)) await o.update(e);
      count++;
    }
    opts.onProgress?.(count);
  };

  if (opts.streamId) {
    await apply(await store.readStream(opts.streamId));
    return count;
  }
  let after = 0;
  for (;;) {
    const batch = await store.readAll({ afterPosition: after, limit: opts.batchSize ?? 500, ...(types.length ? { types } : {}) });
    if (batch.length === 0) break;
    await apply(batch);
    after = batch[batch.length - 1]!.position;
  }
  return count;
}

