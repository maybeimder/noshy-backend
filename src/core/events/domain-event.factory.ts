import { EVENT_TYPES, type EventPayloads, type EventType } from './catalog.js';
import { SYSTEM_STREAM, type DomainEvent, type EventEnvelope, type StoredEvent } from './domain-event.js';
import { newId } from '../shared/ids.js';

export class UnknownEventTypeError extends Error {
  constructor(readonly eventType: string) {
    super(`Tipo de evento desconocido: ${eventType}`);
    this.name = 'UnknownEventTypeError';
  }
}

export class MalformedEventError extends Error {
  constructor(reason: string) {
    super(`Evento mal formado: ${reason}`);
    this.name = 'MalformedEventError';
  }
}

/** Fila de `event_store` tal como la devuelve `pg` (snake_case). */
export type EventRow = {
  event_id: string;
  stream_id: string;
  version: number;
  type: string;
  user_id: string | null;
  payload: unknown;
  occurred_at: Date | string;
  global_position?: number | string;
};

/**
 * GoF Factory: el único lugar donde nace un `DomainEvent`.
 *
 * - `create`: evento nuevo desde un caso de uso (ID, fecha, stream).
 * - `fromRow`: rehidrata desde el event store (relay y replay).
 * - `fromEnvelope` / `toEnvelope`: serializa y rehidrata el mensaje de RabbitMQ.
 *
 * Todo lo que entra se valida contra el catálogo: un tipo desconocido no llega nunca a un observer.
 */
export class DomainEventFactory {
  private readonly known: ReadonlySet<string>;

  constructor(types: readonly string[] = EVENT_TYPES) {
    this.known = new Set(types);
  }

  isKnown(type: string): type is EventType {
    return this.known.has(type);
  }

  create<T extends EventType>(type: T, payload: EventPayloads[T], opts: { id?: string; occurredAt?: Date } = {}): DomainEvent<T> {
    this.assertKnown(type);
    const userId = (payload as { userId?: string }).userId ?? null;
    return this.freeze({
      id: opts.id ?? newId('event'),
      type,
      streamId: userId ?? SYSTEM_STREAM,
      version: 0,
      userId,
      occurredAt: opts.occurredAt ?? new Date(),
      // Copia: el caso de uso puede seguir mutando sus objetos después de emitir.
      payload: structuredClone(payload),
    });
  }

  /** Mismo evento con la versión que le asignó el event store. */
  withVersion<T extends EventType>(event: DomainEvent<T>, version: number, position: number): StoredEvent<T> {
    return Object.freeze({ ...event, version, position });
  }

  fromRow(row: EventRow): StoredEvent {
    this.assertKnown(row.type);
    return Object.freeze({
      ...this.freeze({
        id: row.event_id,
        type: row.type,
        streamId: row.stream_id,
        version: Number(row.version),
        userId: row.user_id,
        occurredAt: new Date(row.occurred_at),
        payload: row.payload as never,
      }),
      position: Number(row.global_position ?? 0),
    });
  }

  toEnvelope(event: DomainEvent): EventEnvelope {
    return {
      schema: 'noshy.event/v1',
      eventId: event.id,
      type: event.type,
      streamId: event.streamId,
      version: event.version,
      userId: event.userId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    };
  }

  fromEnvelope(raw: unknown): DomainEvent {
    if (!raw || typeof raw !== 'object') throw new MalformedEventError('el cuerpo no es un objeto');
    const e = raw as Partial<EventEnvelope>;
    if (e.schema !== 'noshy.event/v1') throw new MalformedEventError(`schema "${String(e.schema)}" no soportado`);
    if (typeof e.eventId !== 'string' || typeof e.type !== 'string' || typeof e.streamId !== 'string') {
      throw new MalformedEventError('faltan eventId, type o streamId');
    }
    const occurredAt = new Date(e.occurredAt ?? '');
    if (Number.isNaN(occurredAt.getTime())) throw new MalformedEventError('occurredAt inválido');
    this.assertKnown(e.type);
    return this.freeze({
      id: e.eventId,
      type: e.type,
      streamId: e.streamId,
      version: Number(e.version ?? 0),
      userId: e.userId ?? null,
      occurredAt,
      payload: (e.payload ?? {}) as never,
    });
  }

  private assertKnown(type: string): asserts type is EventType {
    if (!this.known.has(type)) throw new UnknownEventTypeError(type);
  }

  private freeze<T extends EventType>(event: DomainEvent<T>): DomainEvent<T> {
    return Object.freeze({ ...event, payload: deepFreeze(event.payload) });
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
