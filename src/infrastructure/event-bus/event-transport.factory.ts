import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';
import type { SubjectRegistry } from '../../core/events/subject.js';
import { InProcessTransport, type EventTransport } from '../../core/events/transport.js';
import { RabbitMqConnection } from './rabbitmq/rabbitmq.connection.js';
import { RabbitMqEventConsumer } from './rabbitmq/rabbitmq-event-consumer.js';
import { RabbitMqEventPublisher } from './rabbitmq/rabbitmq-event-publisher.js';
import { RabbitMqTransport } from './rabbitmq/rabbitmq.transport.js';
import { topology } from './rabbitmq/topology.js';
import type { DomainEventFactory } from '../../core/events/domain-event.factory.js';

export type TransportKind = EventTransport['kind'];

/** RabbitMQ si hay `RABBITMQ_URL` (o se pide explícitamente); si no, en proceso. */
export function resolveTransportKind(env: Pick<Env, 'EVENT_TRANSPORT' | 'RABBITMQ_URL'>): TransportKind {
  if (env.EVENT_TRANSPORT) return env.EVENT_TRANSPORT;
  return env.RABBITMQ_URL ? 'rabbitmq' : 'in-process';
}

/**
 * GoF Factory: decide qué transporte de eventos usar y lo arma con sus piezas.
 * El resto del sistema solo conoce la interfaz `EventTransport`.
 */
export class EventTransportFactory {
  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  async create(deps: { subjects: SubjectRegistry; factory: DomainEventFactory }): Promise<EventTransport> {
    const kind = resolveTransportKind(this.env);
    switch (kind) {
      case 'in-process':
        if (this.env.NODE_ENV === 'production') this.log.warn('Eventos en proceso (sin RabbitMQ): define RABBITMQ_URL en producción');
        return new InProcessTransport(deps.subjects);
      case 'rabbitmq':
        return this.rabbitmq(deps);
    }
  }

  private async rabbitmq(deps: { subjects: SubjectRegistry; factory: DomainEventFactory }): Promise<EventTransport> {
    if (!this.env.RABBITMQ_URL) throw new Error('EVENT_TRANSPORT=rabbitmq necesita RABBITMQ_URL');
    const t = topology(this.env.RABBITMQ_PREFIX, this.env.RABBITMQ_RETRY_DELAYS_MS);
    const conn = await RabbitMqConnection.connect(this.env.RABBITMQ_URL, { topology: t, prefetch: this.env.RABBITMQ_PREFETCH, log: this.log });
    const publisher = new RabbitMqEventPublisher(conn, deps.factory, t);
    const consumer = new RabbitMqEventConsumer(conn, deps.factory, deps.subjects, t, this.log);
    return new RabbitMqTransport(conn, publisher, consumer);
  }
}
