import type { ConfirmChannel } from 'amqplib';
import type { DomainEvent } from '../../../core/events/domain-event';
import type { EventDispatcher } from '../../../core/events/subject';
import { Exchanges, toBuffer } from './topology';

// Forma del evento en el cable.
export interface EventEnvelope {
  eventId: string;
  name: string;
  userId: string;
  payload: unknown;
  occurredAt: string;
}

// Dispatcher del OutboxRelay cuando hay RabbitMQ: en vez de notificar observers en este proceso,
// publica el evento en el exchange 'noshy.events'. Solo resuelve cuando el broker confirma; si no
// confirma, el relay deja el mensaje del outbox 'pending' y lo reintenta (nunca se pierde).
export class RabbitMqEventPublisher implements EventDispatcher {
  constructor(
    private readonly channel: ConfirmChannel,
    private readonly exchange: string = Exchanges.events
  ) {}

  dispatch(event: DomainEvent<any>): Promise<void> {
    const envelope: EventEnvelope = {
      eventId: event.eventId,
      name: event.name,
      userId: event.userId,
      payload: event.payload,
      occurredAt: event.occurredAt
    };

    return new Promise((resolve, reject) => {
      this.channel.publish(
        this.exchange,
        event.name,
        toBuffer(envelope),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type: event.name,
          timestamp: Date.parse(event.occurredAt)
        },
        (error) => (error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve())
      );
    });
  }
}
