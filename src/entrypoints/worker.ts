// config -> conecta RabbitMQ -> consume noshy.events.observers -> Subject de cada usuario -> observers
// Las proyecciones (recomendaciones, preferencias, feed de comunidad) viven en este proceso.
import { getEnv } from '../infrastructure/config/env';
import { loadEnvFile } from '../infrastructure/config/load-env-file';
import { RabbitMqEventConsumer } from '../infrastructure/event-bus/rabbitmq/rabbitmq-event-consumer';
import { RabbitMqConnection } from '../infrastructure/event-bus/rabbitmq/rabbitmq.connection';
import { applicationLogger } from '../infrastructure/observability/logger';
import { eventFactory, subjectRegistry } from '../infrastructure/event-bus/register-observers';

async function main() {
  loadEnvFile();
  const environment = getEnv();
  applicationLogger.info('worker.starting', 'Arrancando el worker de observers...');
  if (!environment.rabbitmqUrl) {
    applicationLogger.error('worker.no_rabbitmq', 'El worker necesita RABBITMQ_URL (sin RabbitMQ los observers corren dentro de la API).');
    process.exit(1);
  }

  const rabbit = await RabbitMqConnection.connect(environment.rabbitmqUrl);
  const consumer = new RabbitMqEventConsumer(rabbit.channel, eventFactory, subjectRegistry);
  await consumer.start();
  applicationLogger.info('worker.ready', 'Worker listo: consumiendo eventos de RabbitMQ.');

  process.once('SIGINT', async () => {
    applicationLogger.info('worker.shutdown', 'Señal SIGINT recibida: apagando el worker...');
    await consumer.stop();
    await rabbit.close();
    applicationLogger.info('worker.shutdown.done', 'Worker detenido.');
    process.exit(0);
  });
}

main().catch((error) => {
  applicationLogger.error('worker.startup_failed', 'No se pudo iniciar el worker', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
