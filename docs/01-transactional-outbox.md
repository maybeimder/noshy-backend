# 01 · Transactional Outbox

**Problema.** Guardar en Postgres y publicar en RabbitMQ son dos sistemas sin transacción común. Si el proceso cae entre ambos pasos, se pierde el evento o se publica uno de algo que no ocurrió.

**Solución.** El evento se escribe en Postgres dentro de la **misma transacción** que el cambio de estado. Otro proceso (el relay) lo lee después y lo publica. El evento existe si y solo si la transacción se confirmó.

## 1. Las tablas

### `outbox`

Una fila por entrega pendiente.

| Columna | Para qué |
| --- | --- |
| `id` | Identificador de la entrega (`obx_…`) |
| `event_id` | Evento en `event_store`. Único: una entrega por evento. `ON DELETE CASCADE`: al purgar una cuenta se van también sus entregas |
| `stream_id` | Usuario dueño del evento (`system` si no tiene). Sirve para el orden por usuario |
| `position` | `global_position` del evento: orden de escritura |
| `status` | `pending` → `dispatched`, o `dead` si agotó los intentos |
| `attempts` | Intentos hechos |
| `next_attempt_at` | Cuándo se puede volver a intentar. También marca «en vuelo» (30 s) |
| `last_error` | Último error, recortado a 2000 caracteres |
| `created_at`, `dispatched_at` | Cuándo se creó y cuándo se entregó |

Estados:

```
            reclamo (30 s en vuelo)
 pending ───────────────► entrega ──éxito──► dispatched
    ▲                        │
    └── backoff 2^n s ◄──fallo (attempts < máximo)
                             │
                             └──fallo (attempts = máximo)──► dead
```

Modelo de Drizzle:

📄 [`src/infrastructure/database/postgres/infra.model.ts`](../src/infrastructure/database/postgres/infra.model.ts#L39-L61) · líneas 39–61

```ts
/**
 * Outbox transaccional: una entrega pendiente por evento, escrita en la misma transacción que el evento
 * (y que el cambio de estado). El relay la lee y publica en RabbitMQ.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: text().primaryKey(),
    eventId: text()
      .notNull()
      .unique()
      .references(() => eventStore.eventId, { onDelete: 'cascade' }),
    streamId: text().notNull(),
    position: bigint({ mode: 'number' }).notNull(),
    status: text({ enum: ['pending', 'dispatched', 'dead'] }).notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('outbox_pending_idx').on(t.position).where(sql`status = 'pending'`), index('outbox_stream_idx').on(t.streamId, t.position)],
);
```


SQL de la migración:

📄 [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql#L17-L30) · líneas 17–30

```sql
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"position" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "outbox_eventId_unique" UNIQUE("event_id"),
	CONSTRAINT "outbox_status_check" CHECK ("status" IN ('pending', 'dispatched', 'dead'))
);
```


Llave foránea e índices:

📄 [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql#L32-L32) · líneas 32–32

```sql
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_event_store_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_store"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
```

📄 [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql#L46-L47) · líneas 46–47

```sql
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("position") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_stream_idx" ON "outbox" USING btree ("stream_id","position");--> statement-breakpoint
```


`outbox_pending_idx` es parcial (`WHERE status = 'pending'`): no crece con lo ya entregado.

### `event_store`

Historial de solo agregar. El `outbox` guarda la entrega; el contenido del evento vive aquí.

📄 [`src/infrastructure/database/postgres/infra.model.ts`](../src/infrastructure/database/postgres/infra.model.ts#L18-L21) · líneas 18–21

```ts
/**
 * Event store: historial append-only de todos los eventos de dominio (fuente de verdad para replays).
 * Un stream por usuario; `version` es la posición dentro del stream y `globalPosition` el orden total.
 * Un trigger impide los UPDATE (ver migración 0002); solo se borra al purgar una cuenta.
```


📄 [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql#L2-L15) · líneas 2–15

```sql
CREATE TABLE "event_store" (
	"global_position" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_store_eventId_unique" UNIQUE("event_id"),
	CONSTRAINT "event_store_stream_version_uq" UNIQUE("stream_id","version"),
	CONSTRAINT "event_store_version_positive" CHECK ("version" > 0)
);
```


Un trigger impide modificar un evento guardado:

📄 [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql#L49-L54) · líneas 49–54

```sql
CREATE FUNCTION "event_store_forbid_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'event_store es append-only: no se puede modificar el evento %', OLD.event_id;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "event_store_append_only" BEFORE UPDATE ON "event_store" FOR EACH ROW EXECUTE FUNCTION "event_store_forbid_update"();
```


### `processed_events`

Qué observer ya procesó qué evento. La entrega es *at-least-once* (puede llegar dos veces) y esta tabla evita aplicarla dos veces.

📄 [`src/infrastructure/database/postgres/infra.model.ts`](../src/infrastructure/database/postgres/infra.model.ts#L63-L72) · líneas 63–72

```ts
/** Qué observer ya procesó qué evento: la entrega es at-least-once y esto hace idempotentes a los observers. */
export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: text().notNull(),
    handler: text().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.handler] })],
);
```


La tabla se creó en la primera migración:

📄 [`drizzle/0000_init.sql`](../drizzle/0000_init.sql#L413-L418) · líneas 413–418

```sql
CREATE TABLE "processed_events" (
	"event_id" text NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_handler_pk" PRIMARY KEY("event_id","handler")
);
```


## 2. Escritura: el caso de uso

`outbox.record(tx, …)` recibe la transacción abierta. `outbox.kick()` va **después** del commit.

📄 [`src/modules/community/community.service.ts`](../src/modules/community/community.service.ts#L164-L176) · líneas 164–176

```ts
  async addComment(userId: string, recipeId: string, text: string) {
    const recipe = await this.recipes.getVisible(userId, recipeId);
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    const review = await this.moderation.review({ text, imageKeys: [] });
    if (!review.approved) throw Errors.unprocessable('CONTENT_REJECTED', review.reason ?? 'El comentario no pasó la moderación.');
    const c = await this.db.transaction(async (tx) => {
      const row = await this.recipesRepo.insertComment(tx, { id: newId('comment'), recipeId, userId, text: text.trim() });
      await this.outbox.record(tx, 'comment.created', { userId, recipeId, commentId: row.id, recipeAuthorId: recipe.authorId });
      return row;
    });
    this.outbox.kick();
    return this.commentDto(c, user.name, user.lastName, user.avatarUrl);
```


Otro ejemplo, con varias tablas en la misma transacción:

📄 [`src/modules/onboarding/onboarding.service.ts`](../src/modules/onboarding/onboarding.service.ts#L63-L76) · líneas 63–76

```ts
  async complete(userId: string, tz: string, payload: CompletePayload) {
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    if (user.onboardingStatus === 'completed') throw Errors.conflict('ONBOARDING_ALREADY_COMPLETED', 'Ya configuraste tu chef.');
    this.preferences.validate(payload);
    const resolved = this.preferences.resolve(payload);
    const menuId = newId('menu');
    await this.db.transaction(async (tx) => {
      await this.prefsRepo.upsert(tx, { userId, ...resolved, skippedSteps: payload.skippedSteps });
      await this.users.update(tx, userId, { onboardingStatus: 'completed', timezone: tz });
      await this.menus.create(tx, { id: menuId, userId, weekStart: weekStart(localDate(new Date(), tz)), status: 'generating', progress: { stage: 'restrictions', percent: 0 } });
      await this.outbox.record(tx, 'onboarding.completed', { userId, menuId, skippedSteps: payload.skippedSteps });
    });
    this.outbox.kick();
```


### La clase `Outbox`

- `record(tx, tipo, payload)`: dentro de la transacción del caso de uso.
- `publish(tipo, payload)`: abre su propia transacción, para eventos que no acompañan un cambio de estado.
- `kick()`: despierta al relay sin esperar el siguiente ciclo.

📄 [`src/core/events/outbox.ts`](../src/core/events/outbox.ts#L11-L45) · líneas 11–45

```ts
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
```


### `append`: `event_store` y `outbox` juntos

Antes de numerar el evento toma un *advisory lock* por stream, así dos transacciones del mismo usuario no eligen la misma versión.

📄 [`src/core/events/event-store.ts`](../src/core/events/event-store.ts#L60-L104) · líneas 60–104

```ts
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
```


`Executor` es lo que permite pasar la base o una transacción:

📄 [`src/infrastructure/database/postgres/postgres.client.ts`](../src/infrastructure/database/postgres/postgres.client.ts#L7-L8) · líneas 7–8

```ts
/** Lo que reciben los repositorios: la base o una transacción abierta. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
```


## 3. Lectura: el relay

📄 [`src/core/events/outbox.ts`](../src/core/events/outbox.ts#L51-L180) · líneas 51–180

```ts
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
```


Cómo funciona:

1. **Reclamo.** `FOR UPDATE SKIP LOCKED` deja que varias instancias trabajen sin tomar la misma fila. La fila reclamada se pospone 30 s: si el proceso muere, otro la retoma.
2. **Orden por usuario.** Un stream con una entrega anterior en reintento no se reclama, y si una falla a mitad del lote, las siguientes de ese stream esperan (`blocked`).
3. **Entrega.** `dispatcher.dispatch(evento)`: con RabbitMQ, publicar y esperar el *confirm*.
4. **Fallo.** Backoff de `2^intentos` segundos (máximo 1 h). Al llegar a `OUTBOX_MAX_ATTEMPTS` queda en `dead`.

Se arranca desde [`EventSystem.start`](02-event-driven.md#el-sistema-de-eventos):

| Proceso | Relay |
| --- | --- |
| API | Sí, cuando el transporte es RabbitMQ o `RUN_WORKERS=true` |
| Worker | Siempre: entrega lo que la API no alcanzó a publicar |

## 4. Idempotencia al consumir

📄 [`src/core/events/ledger.ts`](../src/core/events/ledger.ts#L5-L25) · líneas 5–25

```ts
/**
 * Registro de qué observer ya procesó qué evento. RabbitMQ y el relay entregan at-least-once,
 * así que un evento puede llegar dos veces; con esto cada observer lo aplica una sola vez,
 * aunque el proceso se caiga a la mitad o el mensaje vuelva por un reintento.
 */
export class ProcessedEventsLedger {
  constructor(private readonly db: Db) {}

  async done(eventId: string, observers: readonly string[]): Promise<Set<string>> {
    if (observers.length === 0) return new Set();
    const rows = await this.db
      .select({ handler: processedEvents.handler })
      .from(processedEvents)
      .where(and(eq(processedEvents.eventId, eventId), inArray(processedEvents.handler, [...observers])));
    return new Set(rows.map((r) => r.handler));
  }

  async mark(eventId: string, observer: string): Promise<void> {
    await this.db.insert(processedEvents).values({ eventId, handler: observer }).onConflictDoNothing();
  }
}
```


## 5. Garantías y límites

- **Atomicidad:** no hay evento sin cambio de estado ni al revés.
- **At-least-once:** un evento puede llegar más de una vez. Si el proceso cae después de que un observer terminó y antes de `ledger.mark`, ese observer se repite; por eso deben tolerarlo.
- **Orden:** el relay publica por `position` y bloquea el stream que falla, y el Subject serializa los eventos de un usuario dentro de un proceso. Con dos relays a la vez, o cuando un mensaje pasa por una cola de espera de RabbitMQ, el orden entre eventos del mismo usuario no está garantizado.
- **Crecimiento:** las filas `dispatched` y las de `processed_events` no se borran solas.

## 6. Consultas útiles

```sql
-- Estado general
SELECT status, count(*) FROM outbox GROUP BY status;

-- Lo pendiente, con su evento y el último error
SELECT o.id, e.type, o.stream_id, o.attempts, o.next_attempt_at, o.last_error
FROM outbox o JOIN event_store e ON e.event_id = o.event_id
WHERE o.status = 'pending' ORDER BY o.position LIMIT 50;

-- Entregas descartadas
SELECT o.id, e.type, e.payload, o.last_error
FROM outbox o JOIN event_store e ON e.event_id = o.event_id
WHERE o.status = 'dead';

-- Reintentar una entrega descartada
UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = '<obx_…>';

-- Qué observers procesaron un evento
SELECT handler, processed_at FROM processed_events WHERE event_id = '<event_id>';
```
