// Estos en entrypoint son los main de cada proceso
// config -> conecta Postgres (opcional) -> conecta RabbitMQ (opcional) -> arranca OutboxRelay -> consume comandos -> app.listen()
import type { ProcessedMessageStore } from '../core/commands/command-bus';
import type { Outbox } from '../core/events/event-store';
import { getEnv } from '../infrastructure/config/env';
import { createPool } from '../infrastructure/database/db.connection';
import { runMigrations } from '../infrastructure/database/migrations';
import { PostgresEventStore } from '../infrastructure/database/postgres-event-store';
import { createPostgresPersistence, PostgresProcessedMessageStore } from '../infrastructure/database/postgres-persistence';
import { createCommandBus } from '../infrastructure/event-bus/command-bus';
import { getEventStore } from '../infrastructure/event-bus/event-bus';
import { RabbitMqCommandConsumer } from '../infrastructure/event-bus/rabbitmq/rabbitmq-command-consumer';
import { RabbitMqEventPublisher } from '../infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher';
import { RabbitMqConnection } from '../infrastructure/event-bus/rabbitmq/rabbitmq.connection';
import { startEventProcessing, subjectRegistry } from '../infrastructure/event-bus/register-observers';
import { createServer } from '../infrastructure/http/server';
import { configurePersistence } from '../infrastructure/persistence/persistence';

async function main() {
  const environment = getEnv();
  const shutdown: (() => unknown)[] = [];

  // Sin DATABASE_URL todo vive en memoria (se pierde al reiniciar).
  let outbox: Outbox = getEventStore();
  let processedMessages: ProcessedMessageStore | undefined;
  if (environment.databaseUrl) {
    const pool = createPool(environment.databaseUrl);
    const applied = await runMigrations(pool);
    if (applied.length > 0) console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
    const eventStore = new PostgresEventStore(pool);
    configurePersistence(createPostgresPersistence(pool, eventStore));
    outbox = eventStore;
    processedMessages = new PostgresProcessedMessageStore(pool);
    shutdown.push(() => pool.end());
    console.log('Postgres conectado: estado, Event Store y Outbox persistentes.');
  }

  // Un solo bus para HTTP y RabbitMQ: los dos disparan los mismos handlers sobre el mismo estado.
  const commandBus = createCommandBus({ processedMessages });

  if (environment.rabbitmqUrl) {
    const rabbit = await RabbitMqConnection.connect(environment.rabbitmqUrl);
    // Outbox -> exchange noshy.events (los observers corren en el worker).
    shutdown.unshift(startEventProcessing(250, new RabbitMqEventPublisher(rabbit.confirmChannel), outbox));
    // Cola noshy.commands.api -> CommandBus.
    const commands = new RabbitMqCommandConsumer(rabbit.channel, commandBus);
    await commands.start();
    shutdown.unshift(() => commands.stop());
    shutdown.push(() => rabbit.close());
    console.log('RabbitMQ conectado: publicando eventos y consumiendo comandos.');
  } else {
    // Sin RabbitMQ: el relay entrega directo a los observers de este proceso.
    shutdown.unshift(startEventProcessing(250, subjectRegistry, outbox));
  }

  process.once('SIGINT', async () => {
    for (const step of shutdown) await step();
    process.exit(0);
  });

  createServer({ commandBus }).listen(environment.port, () => {
    console.log(`Server is running on port ${environment.port} at http://localhost:${environment.port}`);
  });
}

main().catch((error) => {
  console.error('No se pudo iniciar la API', error);
  process.exit(1);
});
