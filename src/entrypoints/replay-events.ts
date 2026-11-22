import { parseArgs } from 'node:util';
import pino from 'pino';
import { loadEnv } from '../infrastructure/config/env.js';
import { createContainer } from '../container.js';
import { createObservers } from '../infrastructure/event-bus/register-observers.js';
import { isReplayable } from '../core/events/observer.js';
import { replayEvents } from '../core/events/replay.js';

/**
 * Reconstruye proyecciones desde el event store.
 *   pnpm events:replay -- --observer learning --reset
 *   pnpm events:replay -- --observer learning --stream usr_01J… --reset
 * Sin --observer lista los observers que se pueden reproducir.
 */
const { values } = parseArgs({
  options: { observer: { type: 'string', multiple: true }, stream: { type: 'string' }, reset: { type: 'boolean', default: false } },
});

const env = loadEnv({ ...process.env, EVENT_TRANSPORT: 'in-process' });
const log = pino({ level: 'info' });
const c = await createContainer(env, log);
try {
  const replayable = createObservers(c).filter(isReplayable);
  const wanted = values.observer ?? [];
  if (wanted.length === 0) {
    log.info({ observers: replayable.map((o) => o.name) }, 'Observers reproducibles. Usa --observer <nombre> [--stream <userId>] [--reset]');
  } else {
    const picked = replayable.filter((o) => wanted.includes(o.name));
    const unknown = wanted.filter((w) => !picked.some((o) => o.name === w));
    if (unknown.length) throw new Error(`No se pueden reproducir: ${unknown.join(', ')} (o no existen)`);
    const n = await replayEvents(c.events.store, picked, {
      ...(values.stream ? { streamId: values.stream } : {}),
      reset: values.reset,
      onProgress: (done) => log.info({ done }, 'replay'),
    });
    log.info({ events: n, observers: picked.map((o) => o.name), stream: values.stream ?? 'todos' }, 'replay terminado');
  }
} finally {
  await c.close();
}
