import type { Channel, ConsumeMessage } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import type { DomainEventFactory } from '../../../core/events/domain-event.factory.js';
import type { SubjectRegistry } from '../../../core/events/subject.js';
import type { RabbitMqConnection } from './rabbitmq.connection.js';
import { publishConfirmed } from './rabbitmq-event-publisher.js';
import { ATTEMPT_HEADER, ERROR_HEADER, type Topology } from './topology.js';

/**
 * Lee `noshy.events.observers` y entrega cada evento al Subject de su usuario (que notifica a los observers).
 *
 * - Éxito → ack.
 * - Falla un observer → el mensaje pasa a la cola de espera que toca (5 s, 30 s, 2 min, 10 min) y vuelve solo.
 *   En el reintento, los observers que ya lo procesaron se lo saltan.
 * - Agotó los reintentos, o el mensaje no se puede leer → nack sin requeue → `noshy.dlx` → `noshy.dead-letters`.
 */
export class RabbitMqEventConsumer {
  private consumerTag: string | null = null;
  private channel: Channel | null = null;
  private wanted = false;
  private inFlight = 0;
  private processed = 0;

  constructor(
    private readonly conn: RabbitMqConnection,
    private readonly factory: DomainEventFactory,
    private readonly subjects: SubjectRegistry,
    private readonly topology: Topology,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    // Se vuelve a suscribir después de cada reconexión.
    await this.conn.onReady(async ({ consume }) => {
      if (!this.wanted) return;
      this.channel = consume;
      const { consumerTag } = await consume.consume(this.topology.queues.observers, (msg) => void this.onMessage(consume, msg), { noAck: false });
      this.consumerTag = consumerTag;
      this.log.info({ queue: this.topology.queues.observers }, 'rabbitmq: consumiendo eventos');
    });
  }

  async stop(): Promise<void> {
    this.wanted = false;
    if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag).catch(() => undefined);
    this.consumerTag = null;
    await this.settle(10_000);
  }

  get running(): boolean {
    return this.wanted && this.consumerTag !== null;
  }

  /** Espera a que la cola esté vacía y no haya mensajes en proceso. Devuelve cuántos procesó mientras tanto. */
  async settle(timeoutMs = 15_000): Promise<number> {
    const before = this.processed;
    const deadline = Date.now() + timeoutMs;
    let quietChecks = 0;
    while (Date.now() < deadline) {
      const ch = this.conn.current?.consume;
      const waiting = ch && this.running ? (await ch.checkQueue(this.topology.queues.observers)).messageCount : 0;
      if (waiting === 0 && this.inFlight === 0) {
        if (++quietChecks >= 2) break;
      } else quietChecks = 0;
      await new Promise((r) => setTimeout(r, 15));
    }
    return this.processed - before;
  }

  private async onMessage(ch: Channel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) return; // el broker canceló el consumer
    this.inFlight++;
    try {
      let event;
      try {
        event = this.factory.fromEnvelope(JSON.parse(msg.content.toString('utf8')));
      } catch (err) {
        this.log.error({ err, messageId: msg.properties.messageId }, 'rabbitmq: mensaje ilegible, va a dead letters');
        ch.nack(msg, false, false);
        return;
      }

      try {
        await this.subjects.dispatch(event);
        ch.ack(msg);
      } catch (err) {
        await this.retryOrDeadLetter(ch, msg, err);
      }
    } catch (err) {
      // Canal cerrado a mitad de camino: el broker lo reentrega solo.
      this.log.warn({ err }, 'rabbitmq: no se pudo confirmar el mensaje');
    } finally {
      this.inFlight--;
      this.processed++;
    }
  }

  private async retryOrDeadLetter(ch: Channel, msg: ConsumeMessage, err: unknown) {
    const attempt = Number(msg.properties.headers?.[ATTEMPT_HEADER] ?? 0) + 1;
    const retry = this.topology.queues.retries[attempt - 1];
    const ctx = { err, eventType: msg.properties.type, eventId: msg.properties.messageId, attempt };
    const publisher = this.conn.current?.publish;

    if (!retry) {
      this.log.error(ctx, 'rabbitmq: evento agotó reintentos, va a dead letters');
      ch.nack(msg, false, false);
      return;
    }
    if (!publisher) {
      // Sin canal de publicación no se puede diferir: vuelve a la cola (reintento inmediato).
      ch.nack(msg, false, true);
      return;
    }

    const headers = {
      ...msg.properties.headers,
      [ATTEMPT_HEADER]: attempt,
      [ERROR_HEADER]: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
    try {
      await publishConfirmed(publisher, '', retry.name, msg.content, { ...msg.properties, headers, persistent: true });
      ch.ack(msg);
      this.log.warn(ctx, `rabbitmq: evento reintentará en ${retry.delayMs} ms`);
    } catch (pubErr) {
      this.log.warn({ ...ctx, pubErr }, 'rabbitmq: no se pudo diferir el reintento, se reencola');
      ch.nack(msg, false, true);
    }
  }
}
