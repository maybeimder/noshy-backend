import type { DomainEvent } from './domain-event.js';
import type { SubjectRegistry } from './subject.js';

/** A dónde entrega el relay del outbox cada evento. */
export interface EventDispatcher {
  dispatch(event: DomainEvent): Promise<void>;
}

/**
 * Transporte de eventos entre el outbox y los observers. Lo crea `EventTransportFactory`.
 * - `dispatcher`: lo usa el relay (en RabbitMQ: publicar al exchange).
 * - `startConsuming`: empieza a entregar a los observers (en RabbitMQ: consumir la cola).
 * - `settle`: espera a que no quede nada en vuelo; devuelve cuántos eventos entregó mientras tanto (tests y apagado).
 */
export interface EventTransport {
  readonly kind: 'rabbitmq' | 'in-process';
  readonly dispatcher: EventDispatcher;
  startConsuming(): Promise<void>;
  stopConsuming(): Promise<void>;
  settle(timeoutMs?: number): Promise<number>;
  healthy(): boolean;
  close(): Promise<void>;
}

/**
 * Sin broker: el relay notifica directamente a los Subjects de este proceso.
 * Sirve para tests y para correr todo en una sola máquina sin RabbitMQ.
 */
export class InProcessTransport implements EventTransport {
  readonly kind = 'in-process' as const;
  readonly dispatcher: EventDispatcher;

  constructor(subjects: SubjectRegistry) {
    this.dispatcher = { dispatch: (e) => subjects.dispatch(e) };
  }

  async startConsuming() {}
  async stopConsuming() {}
  async settle() {
    return 0;
  }
  healthy() {
    return true;
  }
  async close() {}
}
