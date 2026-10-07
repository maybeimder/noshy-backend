// Estos en entrypoint son los main de cada proceso
// config -> conecta RabbitMQ (opcional) -> arranca OutboxRelay -> consume comandos -> crea un server -> app.listen()
import { getEnv } from '../infrastructure/config/env';
import { createCommandBus } from '../infrastructure/event-bus/command-bus';
import { RabbitMqCommandConsumer } from '../infrastructure/event-bus/rabbitmq/rabbitmq-command-consumer';
import { RabbitMqEventPublisher } from '../infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher';
import { RabbitMqConnection } from '../infrastructure/event-bus/rabbitmq/rabbitmq.connection';
import { startEventProcessing } from '../infrastructure/event-bus/register-observers';
import { createServer } from '../infrastructure/http/server';

async function main() {
  const environment = getEnv();
  // Un solo bus para HTTP y RabbitMQ: los dos disparan los mismos handlers sobre el mismo estado.
  const commandBus = createCommandBus();

  if (environment.rabbitmqUrl) {
    const rabbit = await RabbitMqConnection.connect(environment.rabbitmqUrl);
    // Outbox -> exchange noshy.events (los observers corren en el worker).
    const stopRelay = startEventProcessing(250, new RabbitMqEventPublisher(rabbit.confirmChannel));
    // Cola noshy.commands.api -> CommandBus. Vive aquí porque el estado de los servicios está en memoria.
    const commands = new RabbitMqCommandConsumer(rabbit.channel, commandBus);
    await commands.start();
    console.log('RabbitMQ conectado: publicando eventos y consumiendo comandos.');

    process.once('SIGINT', async () => {
      stopRelay();
      await commands.stop();
      await rabbit.close();
      process.exit(0);
    });
  } else {
    // Sin RabbitMQ: el relay entrega directo a los observers de este proceso.
    startEventProcessing();
  }

  createServer({ commandBus }).listen(environment.port, () => {
    console.log(`Server is running on port ${environment.port} at http://localhost:${environment.port}`);
  });
}

main().catch((error) => {
  console.error('No se pudo iniciar la API', error);
  process.exit(1);
});
