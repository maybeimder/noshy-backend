import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { eventStore, outbox } from '../../infrastructure/database/postgres/infra.model.js';
import { newId } from '../shared/ids.js';
import type { DomainEventFactory, EventRow } from './domain-event.factory.js';
import type { EventType } from './catalog.js';
import type { DomainEvent, StoredEvent } from './domain-event.js';

/** Dos escrituras compitieron por la misma versión de un stream. Con el lock por stream no debería pasar. */
export class StreamVersionConflictError extends Error {
  constructor(readonly streamId: string) {
    super(`Conflicto de versión en el stream ${streamId}`);
    this.name = 'StreamVersionConflictError';
  }
}

export interface EventStore {
  /** Guarda los eventos y su mensaje de outbox en la transacción recibida. Devuelve los eventos con versión. */
  append(exec: Executor, events: DomainEvent[]): Promise<StoredEvent[]>;
  readStream(streamId: string, opts?: { fromVersion?: number }): Promise<StoredEvent[]>;
  readAll(opts?: { afterPosition?: number; limit?: number; types?: readonly EventType[] }): Promise<StoredEvent[]>;
  /** Derecho al olvido: borra el stream de un usuario (menos los tipos que se conservan como lápida). */
  deleteStream(exec: Executor, streamId: string, opts?: { keepTypes?: readonly EventType[] }): Promise<number>;
}

/**
 * No se obtuvo el lock del stream a tiempo. Casi siempre significa que, dentro de una transacción que ya
 * emitió un evento de ese usuario, algo emitió otro con OTRA conexión (sin pasar `tx`): se esperan entre sí.
 */
export class StreamLockTimeoutError extends Error {
  constructor(readonly streamId: string) {
    super(`No se obtuvo el lock del stream ${streamId}: ¿se emitió un evento fuera de la transacción en curso?`);
    this.name = 'StreamLockTimeoutError';
  }
}

/** Espacio del advisory lock por stream (el primer entero de `pg_advisory_xact_lock(int, int)`). */
const STREAM_LOCK_SPACE = 724_100;
const UNIQUE_VIOLATION = '23505';
const LOCK_NOT_AVAILABLE = '55P03';
const STREAM_LOCK_TIMEOUT = '10s';

const isTransaction = (exec: Executor): boolean => 'rollback' in exec;

/**
 * Event Store sobre Postgres. `append` escribe en `event_store` y en `outbox` dentro de la MISMA
 * transacción del caso de uso: el cambio de estado, el evento y su entrega pendiente se confirman juntos
 * (Transactional Outbox). Si `append` recibe la base sin transacción, abre una.
 *
 * Versiones: antes de leer la última versión de un stream se toma `pg_advisory_xact_lock` sobre ese stream,
 * así dos transacciones concurrentes del mismo usuario se ordenan en vez de chocar. El lock se suelta al
 * confirmar o deshacer la transacción.
 */
export class PostgresEventStore implements EventStore {
  constructor(
    private readonly db: Db,
    private readonly factory: DomainEventFactory,
  ) {}

  async append(exec: Executor, events: DomainEvent[]): Promise<StoredEvent[]> {
    if (events.length === 0) return [];
    if (!isTransaction(exec)) return this.db.transaction((tx) => this.append(tx, events));

    // Locks en orden alfabético de stream: dos transacciones con los mismos streams no se bloquean en cruz.
    const streams = [...new Set(events.map((e) => e.streamId))].sort();
    const next = new Map<string, number>();
    // Si el lock no llega en 10 s es un error de programación (ver StreamLockTimeoutError), no algo que esperar.
    await exec.execute(sql`select set_config('lock_timeout', ${STREAM_LOCK_TIMEOUT}, true)`);
    for (const streamId of streams) {
      try {
        await exec.execute(sql`select pg_advisory_xact_lock(${STREAM_LOCK_SPACE}, hashtext(${streamId}))`);
      } catch (err) {
        if (pgCode(err) === LOCK_NOT_AVAILABLE) throw new StreamLockTimeoutError(streamId);
        throw err;
      }
      const res = await exec.execute<{ max: number }>(sql`select coalesce(max(version), 0)::int as max from event_store where stream_id = ${streamId}`);
      next.set(streamId, Number(res.rows[0]?.max ?? 0));
    }

    const stored: StoredEvent[] = [];
    for (const event of events) {
      const version = next.get(event.streamId)! + 1;
      next.set(event.streamId, version);
      try {
        const [row] = await exec
          .insert(eventStore)
          .values({
            eventId: event.id,
            streamId: event.streamId,
            version,
            type: event.type,
            userId: event.userId,
            payload: event.payload,
            occurredAt: event.occurredAt,
          })
          .returning({ position: eventStore.globalPosition });
        await exec.insert(outbox).values({ id: newId('outbox'), eventId: event.id, streamId: event.streamId, position: row!.position });
        stored.push(this.factory.withVersion(event, version, row!.position));
      } catch (err) {
        if (pgCode(err) === UNIQUE_VIOLATION) throw new StreamVersionConflictError(event.streamId);
        throw err;
      }
    }
    return stored;
  }

  async readStream(streamId: string, opts: { fromVersion?: number } = {}): Promise<StoredEvent[]> {
    const rows = await this.db
      .select()
      .from(eventStore)
      .where(and(eq(eventStore.streamId, streamId), gt(eventStore.version, (opts.fromVersion ?? 1) - 1)))
      .orderBy(asc(eventStore.version));
    return rows.map((r) => this.factory.fromRow(toRow(r)));
  }

  async readAll(opts: { afterPosition?: number; limit?: number; types?: readonly EventType[] } = {}): Promise<StoredEvent[]> {
    const rows = await this.db
      .select()
      .from(eventStore)
      .where(and(gt(eventStore.globalPosition, opts.afterPosition ?? 0), opts.types?.length ? inArray(eventStore.type, [...opts.types]) : undefined))
      .orderBy(asc(eventStore.globalPosition))
      .limit(opts.limit ?? 500);
    return rows.map((r) => this.factory.fromRow(toRow(r)));
  }

  async deleteStream(exec: Executor, streamId: string, opts: { keepTypes?: readonly EventType[] } = {}): Promise<number> {
    const keep = opts.keepTypes ?? [];
    const res = await exec
      .delete(eventStore)
      .where(and(eq(eventStore.streamId, streamId), keep.length ? notInArray(eventStore.type, [...keep]) : undefined))
      .returning({ id: eventStore.eventId });
    return res.length;
  }
}

function toRow(r: typeof eventStore.$inferSelect): EventRow {
  return {
    event_id: r.eventId,
    stream_id: r.streamId,
    version: r.version,
    type: r.type,
    user_id: r.userId,
    payload: r.payload,
    occurred_at: r.occurredAt,
    global_position: r.globalPosition,
  };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
