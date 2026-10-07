// config -> conecta RabbitMQ -> consume noshy.events.observers -> Subject de cada usuario -> observers
// Las proyecciones (recomendaciones, preferencias, feed de comunidad) viven en este proceso.
import { getEnv } from '../infrastructure/config/env';
import { loadEnvFile } from '../infrastructure/config/load-env-file';
import { RabbitMqEventConsumer } from '../infrastructure/event-bus/rabbitmq/rabbitmq-event-consumer';
import { RabbitMqConnection } from '../infrastructure/event-bus/rabbitmq/rabbitmq.connection';
import { eventFactory, subjectRegistry } from '../infrastructure/event-bus/register-observers';

async function main() {
  loadEnvFile();
  const environment = getEnv();
  if (!environment.rabbitmqUrl) {
    console.error('El worker necesita RABBITMQ_URL (sin RabbitMQ los observers corren dentro de la API).');
    process.exit(1);
  }

  const rabbit = await RabbitMqConnection.connect(environment.rabbitmqUrl);
  const consumer = new RabbitMqEventConsumer(rabbit.channel, eventFactory, subjectRegistry);
  await consumer.start();
  console.log('Worker listo: consumiendo eventos de RabbitMQ.');

  process.once('SIGINT', async () => {
    await consumer.stop();
    await rabbit.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('No se pudo iniciar el worker', error);
  process.exit(1);
});
