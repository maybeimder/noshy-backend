import { randomUUID } from 'node:crypto';
import type { Channel } from 'amqplib';
import type { CommandEnvelope, CommandReply } from './rabbitmq-command-consumer';
import { Exchanges, fromBuffer, toBuffer } from './topology';

// Pseudo-cola de RabbitMQ para respuestas RPC: no hay que declararla ni borrarla.
const DIRECT_REPLY_TO = 'amq.rabbitmq.reply-to';

// Lo que usaría otro servicio (o un script) para hablarle a Noshy por RabbitMQ.
export class RabbitMqCommandClient {
  private readonly pending = new Map<string, { resolve: (reply: CommandReply) => void; timer: NodeJS.Timeout }>();
  private listening = false;

  constructor(
    private readonly channel: Channel,
    private readonly exchange: string = Exchanges.commands
  ) {}

  // Fire-and-forget: no espera respuesta. messageId permite al consumer descartar reenvíos.
  publish(name: string, envelope: CommandEnvelope, messageId: string = randomUUID()): string {
    this.channel.publish(this.exchange, name, toBuffer(envelope), {
      persistent: true,
      contentType: 'application/json',
      messageId
    });
    return messageId;
  }

  // RPC: publica y espera el outcome del handler (mismo resultado que vería un controller HTTP).
  async send(name: string, envelope: CommandEnvelope, options: { timeoutMs?: number; messageId?: string } = {}): Promise<CommandReply> {
    await this.listenForReplies();
    const correlationId = randomUUID();

    return new Promise<CommandReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new Error(`Sin respuesta para ${name} en ${options.timeoutMs ?? 5000} ms`));
      }, options.timeoutMs ?? 5000);
      this.pending.set(correlationId, { resolve, timer });

      this.channel.publish(this.exchange, name, toBuffer(envelope), {
        contentType: 'application/json',
        messageId: options.messageId ?? randomUUID(),
        correlationId,
        replyTo: DIRECT_REPLY_TO
      });
    });
  }

  private async listenForReplies(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    await this.channel.consume(
      DIRECT_REPLY_TO,
      (message) => {
        const correlationId = message?.properties.correlationId;
        const waiting = correlationId ? this.pending.get(correlationId) : undefined;
        if (!message || !waiting) return;
        clearTimeout(waiting.timer);
        this.pending.delete(correlationId);
        waiting.resolve(fromBuffer<CommandReply>(message.content));
      },
      { noAck: true }
    );
  }
}
