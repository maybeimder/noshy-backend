import type { Channel, ConsumeMessage } from 'amqplib';
import type { CommandBus, HandlerOutcome } from '../../../core/commands/command-bus';
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
  }

  async stop(): Promise<void> {
    if (this.consumerTag) await this.channel.cancel(this.consumerTag);
  }

  async onMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) return;
    const { replyTo, correlationId, messageId } = message.properties;

    let outcome: CommandReply;
    try {
      const envelope = fromBuffer<CommandEnvelope>(message.content);
      outcome = await this.bus.dispatch({
        name: message.fields.routingKey,
        userId: envelope.userId,
        params: envelope.params,
        data: envelope.data,
        messageId: typeof messageId === 'string' ? messageId : undefined
      });
    } catch (error) {
      console.error(`[rabbitmq] fallo ejecutando ${message.fields.routingKey}`, error);
      if (replyTo) {
        this.reply(replyTo, correlationId, { status: 'error', message: error instanceof Error ? error.message : String(error) });
        this.channel.nack(message, false, false);
      } else {
        this.channel.nack(message, false, !message.fields.redelivered);
      }
      return;
    }

    if (replyTo) {
      this.reply(replyTo, correlationId, outcome);
      this.channel.ack(message);
      return;
    }

    if (outcome.status === 'invalid' || outcome.status === 'unknown_handler' || outcome.status === 'unauthorized') {
      console.error(`[rabbitmq] mensaje rechazado ${message.fields.routingKey}: ${outcome.status}`);
      this.channel.nack(message, false, false);
      return;
    }

    this.channel.ack(message);
  }

  private reply(replyTo: string, correlationId: string | undefined, outcome: CommandReply): void {
    this.channel.sendToQueue(replyTo, toBuffer(outcome), { contentType: 'application/json', correlationId });
  }
}
