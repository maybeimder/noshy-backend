// Estos en entrypoint son los main de cada proceso
// config -> conecta Postgres (opcional) -> conecta RabbitMQ (opcional) -> arranca OutboxRelay -> consume comandos -> app.listen()
import type { ProcessedMessageStore } from '../core/commands/command-bus';
import type { Outbox } from '../core/events/event-store';
import { DEFAULT_OPENROUTER_MODELS, OpenRouterChefAgent } from '../infrastructure/ai/openrouter-chef-agent';
import { OpenRouterRecipeWriter } from '../infrastructure/ai/openrouter-recipe-writer';
import { MongoFoodCatalog } from '../infrastructure/database/mongo/mongo-food-catalog';
import { checkFoodIndexes, MongoConnection } from '../infrastructure/database/mongo/mongo.connection';
import { getEnv } from '../infrastructure/config/env';
import { loadEnvFile } from '../infrastructure/config/load-env-file';
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
import { applicationLogger } from '../infrastructure/observability/logger';
import { configureAuthTokens } from '../modules/auth/token';

async function main() {
  if (loadEnvFile()) console.log('Variables cargadas desde .env');
  const environment = getEnv();
  const shutdown: (() => unknown)[] = [];

  applicationLogger.info('api.starting', `Arrancando la API en el puerto ${environment.port}...`, {
    port: environment.port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    corsOrigin: environment.corsOrigin,
    debugLogsEnabled: environment.debugLogsEnabled,
    hasDatabase: Boolean(environment.databaseUrl),
    hasRabbitmq: Boolean(environment.rabbitmqUrl),
    hasMongo: Boolean(environment.mongoUrl),
    hasOpenRouter: Boolean(environment.openRouterApiKey)
  });

  if (environment.jwtSecret) {
    configureAuthTokens({ secret: environment.jwtSecret, expiresIn: environment.jwtExpiresIn });
    applicationLogger.info('api.jwt.configured', 'JWT configurado con el secreto del entorno.', { expiresIn: environment.jwtExpiresIn ?? 'default' });
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET es obligatorio en producción.');
  } else {
    applicationLogger.warn('api.jwt.ephemeral', 'JWT_SECRET no definido: se usa un secreto temporal y los tokens dejan de valer al reiniciar la API.');
  }

  // Sin DATABASE_URL todo vive en memoria (se pierde al reiniciar).
  let outbox: Outbox = getEventStore();
  let processedMessages: ProcessedMessageStore | undefined;
  if (environment.databaseUrl) {
    applicationLogger.info('api.postgres.connecting', 'Conectando a Postgres y aplicando migraciones...');
    const pool = createPool(environment.databaseUrl);
    try {
      const applied = await runMigrations(pool);
      if (applied.length > 0) applicationLogger.info('api.postgres.migrations', `Migraciones aplicadas: ${applied.join(', ')}`, { applied });
      else applicationLogger.info('api.postgres.migrations', 'La base ya estaba al día (sin migraciones pendientes).');
    } catch (error) {
      applicationLogger.error('api.postgres.migration_failed', 'Falló al aplicar las migraciones.', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
    const eventStore = new PostgresEventStore(pool);
    configurePersistence(createPostgresPersistence(pool, eventStore));
    outbox = eventStore;
    processedMessages = new PostgresProcessedMessageStore(pool);
    shutdown.push(() => pool.end());
    applicationLogger.info('api.postgres.connected', 'Postgres conectado: estado, Event Store y Outbox persistentes.');
  } else {
    applicationLogger.warn('api.postgres.disabled', 'Sin DATABASE_URL: estado, Event Store y Outbox viven solo en memoria.');
  }

  // Agente chef: OpenRouter si hay key; si no, POST /chef/sessions/:id/respond responde 503.
  const chefAgent = environment.openRouterApiKey
    ? new OpenRouterChefAgent({ apiKey: environment.openRouterApiKey, models: environment.openRouterModels })
    : undefined;
  if (chefAgent) {
    applicationLogger.info('api.chef.enabled', `Agente chef habilitado con OpenRouter (${(environment.openRouterModels ?? DEFAULT_OPENROUTER_MODELS).join(' -> ')}).`);
  } else {
    applicationLogger.warn('api.chef.disabled', 'Agente chef deshabilitado: define OPENROUTER_API_KEY para activarlo.');
  }

  // Catálogo de alimentos (Mongo, solo lectura). No bloquea el arranque: si Mongo no responde se reintenta
  // en segundo plano y mientras tanto /food responde 503.
  let foodCatalog: MongoFoodCatalog | undefined;
  if (environment.mongoUrl) {
    const mongo = new MongoConnection(environment.mongoUrl);
    foodCatalog = new MongoFoodCatalog(mongo.db());
    const catalog = foodCatalog;
    void mongo.connectWithRetry(async () => {
      for (const warning of await checkFoodIndexes(mongo.db()).catch(() => [])) applicationLogger.warn('mongo.missing_index', warning);
      await catalog.warmUp().catch((error) =>
        applicationLogger.warn('mongo.warmup_failed', 'No se pudo precalcular la paginación de recetas.', {
          error: error instanceof Error ? error.message : String(error)
        })
      );
    });
    shutdown.push(() => mongo.close());
    applicationLogger.info('api.mongo.enabled', 'Catálogo de alimentos habilitado (Mongo en segundo plano).');
  } else {
    applicationLogger.warn('api.mongo.disabled', 'Catálogo de alimentos deshabilitado: define MONGO_URL para activarlo.');
  }
  const recipeWriter = environment.openRouterApiKey
    ? new OpenRouterRecipeWriter({ apiKey: environment.openRouterApiKey, models: environment.openRouterModels })
    : undefined;

  // Un solo bus para HTTP y RabbitMQ: los dos disparan los mismos handlers sobre el mismo estado.
  const commandBus = createCommandBus({ processedMessages, chefAgent, foodCatalog, recipeWriter });
  applicationLogger.info('api.command_bus.ready', `CommandBus listo con ${commandBus.names().length} handlers.`, { handlers: commandBus.names() });

  if (environment.rabbitmqUrl) {
    const rabbit = await RabbitMqConnection.connect(environment.rabbitmqUrl);
    // Outbox -> exchange noshy.events (los observers corren en el worker).
    shutdown.unshift(startEventProcessing(250, new RabbitMqEventPublisher(rabbit.confirmChannel), outbox));
    // Cola noshy.commands.api -> CommandBus.
    const commands = new RabbitMqCommandConsumer(rabbit.channel, commandBus);
    await commands.start();
    shutdown.unshift(() => commands.stop());
    shutdown.push(() => rabbit.close());
    applicationLogger.info('api.rabbitmq.ready', 'RabbitMQ conectado: publicando eventos y consumiendo comandos.');
  } else {
    // Sin RabbitMQ: el relay entrega directo a los observers de este proceso.
    shutdown.unshift(startEventProcessing(250, subjectRegistry, outbox));
    applicationLogger.info('api.events.in_process', 'Sin RabbitMQ: los observers corren dentro de este proceso.');
  }

  process.once('SIGINT', async () => {
    applicationLogger.info('api.shutdown', 'Señal SIGINT recibida: apagando servicios...');
    for (const step of shutdown) await step();
    applicationLogger.info('api.shutdown.done', 'Servicios detenidos. Hasta luego.');
    process.exit(0);
  });

  createServer({ commandBus }).listen(environment.port, () => {
    applicationLogger.info('api.listening', `Server is running on port ${environment.port} at http://localhost:${environment.port}`, {
      port: environment.port,
      debugViewer: environment.debugLogsEnabled ? '/debug/logs/view?token=EL_TOKEN' : 'deshabilitado'
    });
  });
}

main().catch((error) => {
  applicationLogger.error('api.startup_failed', 'No se pudo iniciar la API', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
