import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import { outbox as outboxTable } from '../../infrastructure/database/postgres/infra.model.js';
import type { DomainEventFactory, EventRow } from './domain-event.factory.js';
import type { EventPayloads, EventType } from './catalog.js';
import type { StoredEvent } from './domain-event.js';
import type { EventStore } from './event-store.js';
import type { EventDispatcher } from './transport.js';

/**
 * Lo que usan los casos de uso para emitir eventos.
 * `record` recibe la transacción del caso de uso: el evento queda en el event store y en el outbox
 * si y solo si el cambio de estado se confirma.
 */
export class Outbox {
  private kickHandler: (() => void) | null = null;

  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    private readonly factory: DomainEventFactory,
  ) {}

  async record<T extends EventType>(exec: Executor, type: T, payload: EventPayloads[T]): Promise<StoredEvent<T>> {
    const [stored] = await this.store.append(exec, [this.factory.create(type, payload)]);
    return stored as StoredEvent<T>;
  }

  /** Para eventos que no acompañan un cambio de estado (abre su propia transacción) y despierta al relay. */
  async publish<T extends EventType>(type: T, payload: EventPayloads[T]): Promise<StoredEvent<T>> {
    const stored = await this.record(this.db, type, payload);
    this.kick();
    return stored;
  }

  onKick(fn: () => void) {
    this.kickHandler = fn;
  }

  /** Despierta al relay para que entregue ya, sin esperar el siguiente ciclo de polling. Llamar después del commit. */
  kick() {
    this.kickHandler?.();
  }
}

export type RelayOptions = { batchSize?: number; maxAttempts?: number };

type ClaimedRow = EventRow & { outbox_id: string; attempts: number };

/**
 * Relay del Transactional Outbox: lee las entregas pendientes en orden de escritura, las pasa al
 * dispatcher (en producción, publicar en RabbitMQ con confirmación del broker) y las marca.
 *
 * - Varias instancias pueden correr a la vez: reclaman con `FOR UPDATE SKIP LOCKED`.
 * - Orden por usuario: si una entrega de un stream falla, las siguientes de ese stream esperan.
 * - Reintentos con backoff exponencial; al agotar `maxAttempts` el mensaje queda `dead` (se revisa a mano).
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private kicked = false;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly db: Db,
    private readonly factory: DomainEventFactory,
    private readonly dispatcher: EventDispatcher,
    private readonly log: FastifyBaseLogger,
    opts: RelayOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? 100;
    this.maxAttempts = opts.maxAttempts ?? 10;
  }

  start(intervalMs: number) {
    if (this.timer) return;
    const loop = async () => {
      await this.drain().catch((err) => this.log.error({ err }, 'outbox relay falló'));
      if (this.timer) this.timer = setTimeout(loop, intervalMs);
    };
    this.timer = setTimeout(loop, intervalMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get started() {
    return this.timer !== null;
  }

  kick() {
    if (this.running) {
      this.kicked = true;
      return;
    }
    void this.drain().catch((err) => this.log.error({ err }, 'outbox relay falló'));
  }

  /** Entrega lotes hasta que no quede nada listo. Devuelve cuántos eventos entregó. */
  async drain(): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => {
      let total = 0;
      for (let i = 0; i < 50; i++) {
        this.kicked = false;
        const n = await this.processBatch();
        total += n;
        if (n === 0 && !this.kicked) break;
      }
      return total;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async processBatch(): Promise<number> {
    // Reclama: marca los mensajes como "en vuelo" 30 s para que otra instancia no los tome.
    // Un stream con una entrega anterior en reintento queda bloqueado (orden por usuario).
    const claimed = await this.db.execute<ClaimedRow>(sql`
      with claimable as (
        select o.id from outbox o
        where o.status = 'pending' and o.next_attempt_at <= now()
          and not exists (
            select 1 from outbox p
            where p.stream_id = o.stream_id and p.status = 'pending' and p.position < o.position and p.attempts > 0
          )
        order by o.position
        limit ${this.batchSize}
        for update skip locked
      )
      update outbox o set next_attempt_at = now() + interval '30 seconds'
      from claimable c, event_store e
      where o.id = c.id and e.event_id = o.event_id
      returning o.id as outbox_id, o.attempts, e.event_id, e.stream_id, e.version, e.type, e.user_id, e.payload, e.occurred_at, e.global_position`);

    const rows = claimed.rows.sort((a, b) => Number(a.global_position) - Number(b.global_position));
    const blocked = new Set<string>();
    let delivered = 0;

    for (const row of rows) {
      if (blocked.has(row.stream_id)) {
        await this.db.update(outboxTable).set({ nextAttemptAt: sql`now()` }).where(eq(outboxTable.id, row.outbox_id));
        continue;
      }
      try {
        await this.dispatcher.dispatch(this.factory.fromRow(row));
        await this.db.update(outboxTable).set({ status: 'dispatched', dispatchedAt: new Date(), attempts: row.attempts + 1 }).where(eq(outboxTable.id, row.outbox_id));
        delivered++;
      } catch (err) {
        blocked.add(row.stream_id);
        await this.fail(row, err);
      }
    }
    return delivered;
  }

  private async fail(row: ClaimedRow, err: unknown) {
    const attempts = row.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    const dead = attempts >= this.maxAttempts;
    const backoffSeconds = Math.min(3600, 2 ** attempts);
    await this.db
      .update(outboxTable)
      .set({
        attempts,
        lastError: message.slice(0, 2000),
        status: dead ? 'dead' : 'pending',
        nextAttemptAt: sql`now() + make_interval(secs => ${backoffSeconds})`,
      })
      .where(eq(outboxTable.id, row.outbox_id));
    const ctx = { err, event: row.type, eventId: row.event_id, streamId: row.stream_id, attempts };
    if (dead) this.log.error(ctx, 'outbox: entrega descartada tras agotar intentos (status=dead)');
    else this.log.warn(ctx, 'outbox: entrega falló, se reintentará');
  }
}
