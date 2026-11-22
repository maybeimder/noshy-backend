import pino from 'pino';
import { loadEnv } from '../infrastructure/config/env.js';
import { createContainer } from '../container.js';
import { createObservers } from '../infrastructure/event-bus/register-observers.js';
import { Scheduler } from '../infrastructure/workers/scheduler.js';

/**
 * Proceso de workers, separado del HTTP:
 *   - consume `noshy.events.observers` y notifica al Subject de cada usuario (observers);
 *   - corre el relay del outbox (respaldo de la API: si la API se cae tras escribir, aquí se publica);
 *   - corre las tareas programadas.
 * Úsalo con RUN_WORKERS=false en las instancias HTTP para escalar cada parte por separado.
 */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const container = await createContainer(env, log);
container.events.attach(createObservers(container));
const scheduler = new Scheduler(container);
await container.events.start({ relay: true, consumer: true }, env.OUTBOX_POLL_MS);
scheduler.start();
log.info({ transport: container.events.transport.kind }, 'worker listo: consumer + outbox relay + scheduler');

const shutdown = async () => {
  scheduler.stop();
  await container.events.stop().catch(() => undefined);
  await container.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
