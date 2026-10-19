import type { Channel, ConsumeMessage } from 'amqplib';
import type { DomainEventFactory } from '../../../core/events/domain-event.factory';
import type { EventDispatcher } from '../../../core/events/subject';
import type { EventEnvelope } from './rabbitmq-event-publisher';
import { applicationLogger } from '../../observability/logger';
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
    applicationLogger.info('rabbitmq.events.consuming', `Consumiendo eventos de la cola "${this.queue}".`, { queue: this.queue, consumerTag });
  }

  async stop(): Promise<void> {
    if (this.consumerTag) await this.channel.cancel(this.consumerTag);
    applicationLogger.info('rabbitmq.events.stopped', `Consumer de eventos detenido (${this.queue}).`, { queue: this.queue });
  }

  async onMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) return; // el broker canceló el consumer

    try {
      const envelope = fromBuffer<EventEnvelope>(message.content);
      applicationLogger.debug('rabbitmq.event.received', `Evento de RabbitMQ: ${envelope.name}`, {
        eventId: envelope.eventId,
        name: envelope.name,
        userId: envelope.userId,
        redelivered: message.fields.redelivered
      });
      const event = this.factory.create({
        eventId: envelope.eventId,
        streamId: envelope.userId,
        version: 0,
        type: envelope.name,
        payload: envelope.payload,
        occurredAt: envelope.occurredAt
      });
      await this.dispatcher.dispatch(event);
      applicationLogger.debug('rabbitmq.event.processed', `Evento procesado por observers: ${envelope.name}`, {
        eventId: envelope.eventId,
        name: envelope.name,
        userId: envelope.userId
      });
      this.channel.ack(message);
    } catch (error) {
      applicationLogger.error('rabbitmq.event.failed', `Fallo procesando evento ${message.properties.messageId ?? '?'}`, {
        messageId: typeof message.properties.messageId === 'string' ? message.properties.messageId : undefined,
        redelivered: message.fields.redelivered,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      this.channel.nack(message, false, !message.fields.redelivered);
    }
  }
}
