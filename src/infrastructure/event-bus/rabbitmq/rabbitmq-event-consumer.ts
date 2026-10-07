import type { Channel, ConsumeMessage } from 'amqplib';
import type { DomainEventFactory } from '../../../core/events/domain-event.factory';
import type { EventDispatcher } from '../../../core/events/subject';
import type { EventEnvelope } from './rabbitmq-event-publisher';
import { fromBuffer, Queues } from './topology';

// Lee 'noshy.events.observers' y entrega cada evento al Subject del usuario (observers).
// ack = listo. Si falla: primer intento -> vuelve a la cola; segundo -> dead letters.
// Los observers son idempotentes (por eventId), así que una reentrega no duplica nada.
export class RabbitMqEventConsumer {
  private consumerTag?: string;

  constructor(
    private readonly channel: Channel,
    private readonly factory: DomainEventFactory,
    private readonly dispatcher: EventDispatcher,
    private readonly queue: string = Queues.observers
  ) {}

  async start(): Promise<void> {
    const { consumerTag } = await this.channel.consume(this.queue, (message) => void this.onMessage(message), { noAck: false });
    this.consumerTag = consumerTag;
  }

  async stop(): Promise<void> {
    if (this.consumerTag) await this.channel.cancel(this.consumerTag);
  }

  async onMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) return; // el broker canceló el consumer

    try {
      const envelope = fromBuffer<EventEnvelope>(message.content);
      const event = this.factory.create({
        eventId: envelope.eventId,
        streamId: envelope.userId,
        version: 0,
        type: envelope.name,
        payload: envelope.payload,
        occurredAt: envelope.occurredAt
      });
      await this.dispatcher.dispatch(event);
      this.channel.ack(message);
    } catch (error) {
      console.error(`[rabbitmq] fallo procesando evento ${message.properties.messageId ?? '?'}`, error);
      this.channel.nack(message, false, !message.fields.redelivered);
    }
  }
}
