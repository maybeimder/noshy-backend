import type { ConfirmChannel, Options } from 'amqplib';
import type { DomainEventFactory } from '../../../core/events/domain-event.factory.js';
import type { DomainEvent } from '../../../core/events/domain-event.js';
import type { EventDispatcher } from '../../../core/events/transport.js';
import type { RabbitMqConnection } from './rabbitmq.connection.js';
import type { Topology } from './topology.js';

export class BrokerUnavailableError extends Error {
  constructor() {
    super('RabbitMQ no está conectado');
    this.name = 'BrokerUnavailableError';
  }
}

/** Publica en un canal con confirms y resuelve solo cuando el broker confirma. */
export function publishConfirmed(ch: ConfirmChannel, exchange: string, routingKey: string, body: Buffer, options: Options.Publish): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      ch.publish(exchange, routingKey, body, options, (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Dispatcher del relay con RabbitMQ: publica cada evento en el exchange `noshy.events` con routing key
 * igual a su tipo. Solo resuelve con el ack del broker; si falla, el outbox lo deja pendiente y reintenta.
 */
export class RabbitMqEventPublisher implements EventDispatcher {
  constructor(
    private readonly conn: RabbitMqConnection,
    private readonly factory: DomainEventFactory,
    private readonly topology: Topology,
  ) {}

  async dispatch(event: DomainEvent): Promise<void> {
    const ch = this.conn.current?.publish;
    if (!ch) throw new BrokerUnavailableError();
    await publishConfirmed(ch, this.topology.exchanges.events, event.type, Buffer.from(JSON.stringify(this.factory.toEnvelope(event))), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.id,
      type: event.type,
      timestamp: Math.floor(event.occurredAt.getTime() / 1000),
      appId: 'noshy-backend',
      headers: { 'x-stream-id': event.streamId, 'x-stream-version': event.version },
    });
  }
}
