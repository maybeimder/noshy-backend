import type { FastifyBaseLogger } from 'fastify';
import type { DomainEvent } from './domain-event.js';
import type { ProcessedEventsLedger } from './ledger.js';
import type { Observer } from './observer.js';

export class ObserversFailedError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly event: DomainEvent,
    readonly failedObservers: string[],
  ) {
    super(errors, `${failedObservers.length} observer(s) fallaron con "${event.type}" (${event.id}): ${failedObservers.join(', ')}`);
    this.name = 'ObserversFailedError';
  }
}

/**
 * GoF Subject: uno por stream (por usuario). Mantiene sus observers y los notifica.
 *
 * - Serializa sus notificaciones: los eventos de un mismo usuario se procesan en orden,
 *   aunque el consumer de RabbitMQ reciba varios mensajes a la vez.
 * - Notifica a todos aunque alguno falle; si hubo fallos lanza `ObserversFailedError` para que
 *   el transporte reintente. En el reintento, los que ya tuvieron éxito se saltan (ledger).
 */
export class EventSubject {
  private readonly observers: Observer[] = [];
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    readonly streamId: string,
    private readonly ledger: ProcessedEventsLedger,
    private readonly log: FastifyBaseLogger,
    private readonly beforeNotify?: () => Promise<void>,
  ) {}

  attach(observer: Observer): void {
    if (!this.observers.includes(observer)) this.observers.push(observer);
  }

  detach(observer: Observer): void {
    const i = this.observers.indexOf(observer);
    if (i !== -1) this.observers.splice(i, 1);
  }

  get idle(): boolean {
    return this.pending === 0;
  }

  notify(event: DomainEvent): Promise<void> {
    this.pending++;
    const run = this.tail.then(() => this.notifyNow(event));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => this.pending--);
  }

  private async notifyNow(event: DomainEvent): Promise<void> {
    const interested = this.observers.filter((o) => o.interestedIn(event.type));
    if (interested.length === 0) return;
    const done = await this.ledger.done(
      event.id,
      interested.map((o) => o.name),
    );
    await this.beforeNotify?.();
    const errors: unknown[] = [];
    const failed: string[] = [];
    for (const observer of interested) {
      if (done.has(observer.name)) continue;
      try {
        await observer.update(event);
        await this.ledger.mark(event.id, observer.name);
      } catch (err) {
        errors.push(err);
        failed.push(observer.name);
        this.log.warn({ err, event: event.type, eventId: event.id, observer: observer.name }, 'observer falló');
      }
    }
    if (errors.length) throw new ObserversFailedError(errors, event, failed);
  }
}

/**
 * Crea el Subject de cada stream bajo demanda y le conecta los observers del sistema.
 * Guarda como máximo `maxSubjects` en memoria; los que están ociosos se descartan primero
 * (se vuelven a crear igual la próxima vez, no tienen estado propio más allá de la cola).
 */
export class SubjectRegistry {
  private readonly subjects = new Map<string, EventSubject>();
  private readonly systemObservers: Observer[] = [];

  constructor(
    private readonly ledger: ProcessedEventsLedger,
    private readonly log: FastifyBaseLogger,
    private readonly maxSubjects = 5_000,
    /** Antes de notificar cada evento (p. ej. poner al día cachés que cambió otro proceso). */
    private readonly beforeNotify?: () => Promise<void>,
  ) {}

  /** Conecta un observer a todos los Subjects, los actuales y los que se creen después. */
  attach(observer: Observer): void {
    if (this.systemObservers.some((o) => o.name === observer.name)) throw new Error(`Observer duplicado: ${observer.name}`);
    this.systemObservers.push(observer);
    for (const s of this.subjects.values()) s.attach(observer);
  }

  detach(observer: Observer): void {
    const i = this.systemObservers.indexOf(observer);
    if (i !== -1) this.systemObservers.splice(i, 1);
    for (const s of this.subjects.values()) s.detach(observer);
  }

  get observers(): readonly Observer[] {
    return this.systemObservers;
  }

  subjectFor(streamId: string): EventSubject {
    let subject = this.subjects.get(streamId);
    if (subject) {
      // LRU: lo movemos al final.
      this.subjects.delete(streamId);
      this.subjects.set(streamId, subject);
      return subject;
    }
    subject = new EventSubject(streamId, this.ledger, this.log, this.beforeNotify);
    for (const o of this.systemObservers) subject.attach(o);
    this.subjects.set(streamId, subject);
    this.evictIdle();
    return subject;
  }

  dispatch(event: DomainEvent): Promise<void> {
    return this.subjectFor(event.streamId).notify(event);
  }

  private evictIdle() {
    if (this.subjects.size <= this.maxSubjects) return;
    for (const [id, s] of this.subjects) {
      if (this.subjects.size <= this.maxSubjects) break;
      if (s.idle) this.subjects.delete(id);
    }
  }
}
