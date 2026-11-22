import type { EventTransport } from '../../../core/events/transport.js';
import type { RabbitMqConnection } from './rabbitmq.connection.js';
import type { RabbitMqEventConsumer } from './rabbitmq-event-consumer.js';
import type { RabbitMqEventPublisher } from './rabbitmq-event-publisher.js';

export class RabbitMqTransport implements EventTransport {
  readonly kind = 'rabbitmq' as const;

  constructor(
    private readonly conn: RabbitMqConnection,
    readonly dispatcher: RabbitMqEventPublisher,
    private readonly consumer: RabbitMqEventConsumer,
  ) {}

  startConsuming() {
    return this.consumer.start();
  }

  stopConsuming() {
    return this.consumer.stop();
  }

  settle(timeoutMs?: number) {
    return this.consumer.settle(timeoutMs);
  }

  healthy() {
    return this.conn.connected;
  }

  async close() {
    await this.consumer.stop().catch(() => undefined);
    await this.conn.close();
  }
}
