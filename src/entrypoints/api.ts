import { loadEnv } from '../infrastructure/config/env.js';
import { buildApp } from '../infrastructure/http/server.js';
import { Scheduler } from '../infrastructure/workers/scheduler.js';
import { runMigrations } from '../infrastructure/database/postgres/migrate.js';
import { createPostgres } from '../infrastructure/database/postgres/postgres.client.js';
import { seedIfEmpty } from '../infrastructure/database/seed/seed.js';

const env = loadEnv();
if (env.MIGRATE_ON_START) await runMigrations(env.DATABASE_URL);
if (env.SEED_ON_START) {
  const pg = createPostgres(env.DATABASE_URL);
  const seeded = await seedIfEmpty(pg.db);
  await pg.close();
  if (seeded) console.log('Catálogo inicial cargado');
}
const app = await buildApp({ env });
if (env.NODE_ENV === 'production' && ['localhost', '127.0.0.1'].includes(new URL(env.PUBLIC_BASE_URL).hostname))
  app.log.error({ PUBLIC_BASE_URL: env.PUBLIC_BASE_URL }, 'PUBLIC_BASE_URL apunta a esta máquina: nadie podrá subir fotos. Define el dominio público de la API');
const { events } = app.container;
// Sin bloquear el arranque: son cientos de recetas la primera vez y ninguna después.
void app.container.services.recipePhotos
  .backfill()
  .then((n) => n && app.log.info({ n }, 'fotos de referencia asignadas'))
  .catch((err: unknown) => app.log.warn({ err }, 'no se pudieron asignar las fotos de referencia'));
const scheduler = new Scheduler(app.container);

// La API siempre publica lo que escribe en el outbox cuando hay RabbitMQ (latencia mínima).
// Con RUN_WORKERS=true además consume y corre el scheduler (todo en un proceso).
await events.start({ relay: events.transport.kind === 'rabbitmq' || env.RUN_WORKERS, consumer: env.RUN_WORKERS }, env.OUTBOX_POLL_MS);
if (env.RUN_WORKERS) scheduler.start();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'cerrando');
  scheduler.stop();
  await events.stop().catch(() => undefined);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.PORT, host: '0.0.0.0' });
