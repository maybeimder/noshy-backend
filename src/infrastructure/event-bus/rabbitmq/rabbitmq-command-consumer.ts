import type { Channel, ConsumeMessage } from 'amqplib';
import type { CommandBus, HandlerOutcome } from '../../../core/commands/command-bus';
import { applicationLogger } from '../../observability/logger';
import { fromBuffer, Queues, toBuffer } from './topology';

// Cuerpo de un mensaje de entrada. El nombre del handler viaja en la routing key.
export interface CommandEnvelope {
  userId?: string;
  params?: Record<string, string | undefined>;
  data?: unknown;
}

export type CommandReply = HandlerOutcome | { status: 'error'; message: string };

// Lee 'noshy.commands.api' y despacha al MISMO CommandBus que usa HTTP.
//  - Con replyTo (RPC): responde el outcome al emisor y hace ack.
//  - Sin replyTo (fire-and-forget): ack si se manejó; un mensaje inválido o desconocido va a dead letters.
//  - Excepción: primer intento -> vuelve a la cola; segundo -> dead letters.
export class RabbitMqCommandConsumer {
  private consumerTag?: string;

  constructor(
    private readonly channel: Channel,
    private readonly bus: CommandBus,
    private readonly queue: string = Queues.commands
  ) {}

  async start(): Promise<void> {
    const { consumerTag } = await this.channel.consume(this.queue, (message) => void this.onMessage(message), { noAck: false });
    this.consumerTag = consumerTag;
    applicationLogger.info('rabbitmq.commands.consuming', `Consumiendo comandos de la cola "${this.queue}".`, { queue: this.queue, consumerTag });
  }

  async stop(): Promise<void> {
    if (this.consumerTag) await this.channel.cancel(this.consumerTag);
    applicationLogger.info('rabbitmq.commands.stopped', `Consumer de comandos detenido (${this.queue}).`, { queue: this.queue });
  }

  async onMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) return;
    const { replyTo, correlationId, messageId } = message.properties;

    let outcome: CommandReply;
    try {
      const envelope = fromBuffer<CommandEnvelope>(message.content);
      applicationLogger.debug('rabbitmq.command.received', `Mensaje de RabbitMQ: ${message.fields.routingKey}`, {
        routingKey: message.fields.routingKey,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        userId: envelope.userId,
        replyTo: replyTo ?? undefined,
        redelivered: message.fields.redelivered
      });
      outcome = await this.bus.dispatch({
        name: message.fields.routingKey,
        userId: envelope.userId,
        params: envelope.params,
        data: envelope.data,
        messageId: typeof messageId === 'string' ? messageId : undefined
      });
    } catch (error) {
      applicationLogger.error('rabbitmq.command.failed', `Fallo ejecutando ${message.fields.routingKey}`, {
        routingKey: message.fields.routingKey,
        messageId: typeof messageId === 'string' ? messageId : undefined,
        redelivered: message.fields.redelivered,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      if (replyTo) {
        this.reply(replyTo, correlationId, { status: 'error', message: error instanceof Error ? error.message : String(error) });
        this.channel.nack(message, false, false);
      } else {
        this.channel.nack(message, false, !message.fields.redelivered);
      }
      return;
    }

    if (replyTo) {
      applicationLogger.debug('rabbitmq.command.replied', `Reply RPC para ${message.fields.routingKey} (${outcome.status}).`, {
        routingKey: message.fields.routingKey,
        replyTo,
        status: outcome.status
      });
      this.reply(replyTo, correlationId, outcome);
      this.channel.ack(message);
      return;
    }

    if (outcome.status === 'invalid' || outcome.status === 'unknown_handler' || outcome.status === 'unauthorized') {
      applicationLogger.warn('rabbitmq.command.rejected', `Mensaje rechazado ${message.fields.routingKey}: ${outcome.status}`, {
        routingKey: message.fields.routingKey,
        status: outcome.status
      });
      this.channel.nack(message, false, false);
      return;
    }

    this.channel.ack(message);
  }

  private reply(replyTo: string, correlationId: string | undefined, outcome: CommandReply): void {
    this.channel.sendToQueue(replyTo, toBuffer(outcome), { contentType: 'application/json', correlationId });
  }
}
