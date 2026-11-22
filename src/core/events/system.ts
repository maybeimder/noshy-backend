import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { DomainEventFactory } from './domain-event.factory.js';
import type { EventStore } from './event-store.js';
import type { Observer } from './observer.js';
import type { Outbox, OutboxRelay } from './outbox.js';
import type { SubjectRegistry } from './subject.js';
import type { EventTransport } from './transport.js';

export type EventRoles = { relay: boolean; consumer: boolean };

/**
 * Todo el sistema de eventos en un objeto:
 *
 *   caso de uso ─tx─▶ Outbox.record ─▶ event_store + outbox (misma transacción)
 *   OutboxRelay ─▶ transport.dispatcher (RabbitMQ: exchange noshy.events)
 *   transport consumer ─▶ SubjectRegistry ─▶ Subject del usuario ─▶ Observers
 */
export class EventSystem {
  constructor(
    readonly db: Db,
    readonly factory: DomainEventFactory,
    readonly store: EventStore,
    readonly outbox: Outbox,
    readonly relay: OutboxRelay,
    readonly subjects: SubjectRegistry,
    readonly transport: EventTransport,
    private readonly log: FastifyBaseLogger,
  ) {
    outbox.onKick(() => {
      if (relay.started) relay.kick();
    });
  }

  attach(observers: readonly Observer[]) {
    for (const o of observers) this.subjects.attach(o);
  }

  /** Arranca el relay (publicar) y/o el consumer (procesar) en este proceso. */
  async start(roles: EventRoles, pollMs: number) {
    if (roles.consumer) await this.transport.startConsuming();
    if (roles.relay) this.relay.start(pollMs);
    this.log.info({ transport: this.transport.kind, ...roles }, 'eventos: en marcha');
  }

  /**
   * Entrega todo lo pendiente y espera a que los observers terminen, incluidos los eventos que ellos mismos
   * emiten. En producción esto pasa solo; aquí lo usan los tests y el apagado ordenado.
   */
  async drain(): Promise<number> {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const published = await this.relay.drain();
      const consumed = await this.transport.settle();
      total += published;
      if (published === 0 && consumed === 0) break;
    }
    return total;
  }

  async stop() {
    this.relay.stop();
    await this.transport.stopConsuming();
  }

  async close() {
    this.relay.stop();
    await this.transport.close();
  }
}
