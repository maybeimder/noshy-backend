# 03 · RabbitMQ

| Pregunta | Respuesta | Archivo |
| --- | --- | --- |
| ¿Dónde se declara? | `assertTopology`, en cada conexión | [`topology.ts`](../src/infrastructure/event-bus/rabbitmq/topology.ts) |
| ¿Dónde se conecta? | `RabbitMqConnection.connect` | [`rabbitmq.connection.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq.connection.ts) |
| ¿Dónde se publica? | `RabbitMqEventPublisher.dispatch`, llamado por el relay | [`rabbitmq-event-publisher.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher.ts) |
| ¿Dónde se procesa? | `RabbitMqEventConsumer.onMessage` | [`rabbitmq-event-consumer.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq-event-consumer.ts) |
| ¿En qué proceso? | `worker` (contenedor `noshy-worker`) | [`worker.ts`](../src/entrypoints/worker.ts) |

## Topología

```
 outbox relay ──publish (routing key = tipo)──► noshy.events (topic)
                                                   │ #
                                                   ▼
                                        noshy.events.observers ──► consumer ──► Subject ──► observers
                                           ▲             │ falla
                        TTL vencido, vuelve│             ├──► noshy.events.retry.5000ms / 30000ms / 120000ms / 600000ms
                                           └─────────────┘
                                                         └──► agotó los reintentos o ilegible
                                                              noshy.dlx (fanout) ──► noshy.dead-letters
```

| Nombre | Tipo | Papel |
| --- | --- | --- |
| `noshy.events` | exchange topic | Todos los eventos. Routing key = tipo |
| `noshy.events.observers` | cola durable | La consume el worker |
| `noshy.events.retry.<ms>ms` | colas con TTL, sin consumidor | Espera entre reintentos |
| `noshy.dlx` | exchange fanout | Mensajes que no se pudieron procesar |
| `noshy.dead-letters` | cola durable | Revisión manual |

📄 [`src/infrastructure/event-bus/rabbitmq/topology.ts`](../src/infrastructure/event-bus/rabbitmq/topology.ts#L1-L60) · líneas 1–60

```ts
import type { Channel } from 'amqplib';

/**
 * Nombres de exchanges y colas. Un broker que ya los tenga declarados con los mismos argumentos se reutiliza.
 *
 *   outbox relay ──publish(routingKey = tipo del evento)──▶ noshy.events (topic)
 *                                                              │ '#'
 *                                                              ▼
 *                                                  noshy.events.observers ──▶ worker → Subject → Observers
 *                                                     ▲            │ falla
 *                         (TTL vencido, vuelve) ──────┘            ├──▶ noshy.events.retry.<n>ms (espera)
 *                                                                  └──▶ agotó intentos → noshy.dlx (fanout) → noshy.dead-letters
 */
export type Topology = {
  exchanges: { events: string; deadLetters: string };
  queues: { observers: string; deadLetters: string; retries: { name: string; delayMs: number }[] };
};

export const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

export function topology(prefix = 'noshy', retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS): Topology {
  return {
    exchanges: {
      // Routing key = tipo del evento (ej. `pantry.items_added`): se puede suscribir por patrón (`pantry.*`).
      events: `${prefix}.events`,
      // Todo mensaje que se rinde termina aquí (fanout → una sola cola de revisión).
      deadLetters: `${prefix}.dlx`,
    },
    queues: {
      observers: `${prefix}.events.observers`,
      deadLetters: `${prefix}.dead-letters`,
      // El nombre lleva el retardo: cambiar los tiempos crea colas nuevas en vez de chocar con las viejas.
      retries: retryDelaysMs.map((delayMs) => ({ name: `${prefix}.events.retry.${delayMs}ms`, delayMs })),
    },
  };
}

/** Idempotente: declarar lo que ya existe con los mismos argumentos no hace nada. */
export async function assertTopology(channel: Channel, t: Topology): Promise<void> {
  await channel.assertExchange(t.exchanges.deadLetters, 'fanout', { durable: true });
  await channel.assertQueue(t.queues.deadLetters, { durable: true });
  await channel.bindQueue(t.queues.deadLetters, t.exchanges.deadLetters, '');

  await channel.assertExchange(t.exchanges.events, 'topic', { durable: true });
  await channel.assertQueue(t.queues.observers, { durable: true, deadLetterExchange: t.exchanges.deadLetters });
  await channel.bindQueue(t.queues.observers, t.exchanges.events, '#');

  // Colas de espera: sin consumidores. Al vencer el TTL, RabbitMQ devuelve el mensaje a la cola de observers.
  for (const r of t.queues.retries) {
    await channel.assertQueue(r.name, {
      durable: true,
      messageTtl: r.delayMs,
      deadLetterExchange: '',
      deadLetterRoutingKey: t.queues.observers,
    });
  }
}

export const ATTEMPT_HEADER = 'x-noshy-attempt';
export const ERROR_HEADER = 'x-noshy-last-error';
```


## Conexión

Reconecta sola, vuelve a declarar la topología y avisa al consumer para que se suscriba otra vez. Usa dos canales: uno para consumir (con `prefetch`) y otro para publicar (con *confirms*).

📄 [`src/infrastructure/event-bus/rabbitmq/rabbitmq.connection.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq.connection.ts#L8-L94) · líneas 8–94

```ts
/**
 * Una conexión con reconexión automática y dos canales:
 *  - `consume`: para consumir (el prefetch limita cuántos mensajes sin ack recibe a la vez).
 *  - `publish`: con publisher confirms (el broker confirma que guardó el mensaje).
 *
 * Tras cada (re)conexión se vuelven a crear los canales, se declara la topología y se avisa a los
 * listeners (el consumer vuelve a suscribirse). Mientras no hay conexión, publicar falla y el outbox
 * deja el evento pendiente: nada se pierde.
 */
export class RabbitMqConnection {
  private channels: Channels | null = null;
  private readonly listeners: ReadyListener[] = [];
  private closing = false;

  private constructor(
    private readonly model: RecoveringChannelModel,
    private readonly log: FastifyBaseLogger,
  ) {}

  static async connect(
    url: string,
    opts: { topology: Topology; prefetch: number; log: FastifyBaseLogger; initialRetries?: number },
  ): Promise<RabbitMqConnection> {
    let self: RabbitMqConnection | null = null;
    const pendingSetup: ChannelModel[] = [];
    const model = await connect(url, {
      recovery: {
        initialDelay: 500,
        maxDelay: 15_000,
        initialMaxRetries: opts.initialRetries ?? 20,
        maxRetries: Infinity,
        waitForConnect: false,
        setup: async (m: ChannelModel) => {
          if (self) await self.setup(m, opts.topology, opts.prefetch);
          else pendingSetup.push(m);
        },
      },
    });
    self = new RabbitMqConnection(model, opts.log);
    const conn = self;
    model.on('error', (err) => opts.log.error({ err }, 'rabbitmq: error de conexión'));
    model.on('disconnect', (err) => {
      conn.channels = null;
      if (!conn.closing) opts.log.warn({ err }, 'rabbitmq: desconectado, reintentando');
    });
    model.on('reconnect-scheduled', ({ attempt, delay }) => opts.log.info({ attempt, delay }, 'rabbitmq: reconexión programada'));
    model.on('connect-failed', (err) => opts.log.warn({ err: err.message }, 'rabbitmq: intento de conexión falló'));
    await model.waitForConnect();
    // La primera conexión pudo terminar antes de que existiera `self`.
    for (const m of pendingSetup.splice(0)) await conn.setup(m, opts.topology, opts.prefetch);
    opts.log.info({ prefetch: opts.prefetch }, 'rabbitmq: conectado');
    return conn;
  }

  private async setup(m: ChannelModel, t: Topology, prefetch: number) {
    const consume = await m.createChannel();
    const publish = await m.createConfirmChannel();
    for (const ch of [consume, publish]) {
      ch.on('error', (err) => this.log.error({ err }, 'rabbitmq: error de canal'));
      ch.on('handler-error', (err) => this.log.error({ err }, 'rabbitmq: error en handler'));
    }
    await consume.prefetch(prefetch);
    await assertTopology(consume, t);
    this.channels = { consume, publish };
    for (const l of this.listeners) await l(this.channels);
  }

  /** Se llama ahora (si hay conexión) y después de cada reconexión. */
  async onReady(listener: ReadyListener) {
    this.listeners.push(listener);
    if (this.channels) await listener(this.channels);
  }

  get current(): Channels | null {
    return this.channels;
  }

  get connected(): boolean {
    return this.channels !== null;
  }

  async close() {
    this.closing = true;
    this.channels = null;
    await this.model.close().catch(() => undefined);
  }
}
```


## Publicar

Solo resuelve cuando el broker confirma. Si falla, la fila del [outbox](01-transactional-outbox.md) queda pendiente.

📄 [`src/infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher.ts#L15-L24) · líneas 15–24

```ts
/** Publica en un canal con confirms y resuelve solo cuando el broker confirma. */
export function publishConfirmed(ch: ConfirmChannel, exchange: string, routingKey: string, body: Buffer, options: Options.Publish): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      ch.publish(exchange, routingKey, body, options, (err) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve()));
    } catch (err) {
      reject(err);
    }
  });
}
```

📄 [`src/infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq-event-publisher.ts#L26-L50) · líneas 26–50

```ts
/**
 * Dispatcher del relay con RabbitMQ: publica cada evento en el exchange `noshy.events` con routing key
 * igual a su tipo. Solo resuelve con el ack del broker; si falla, el outbox lo deja pendiente y reintenta.
 */
export class RabbitMqEventPublisher implements EventDispatcher {
  constructor(
    private readonly conn: RabbitMqConnection,
    private readonly factory: DomainEventFactory,
    private readonly topology: Topology,
  ) {}

  async dispatch(event: DomainEvent): Promise<void> {
    const ch = this.conn.current?.publish;
    if (!ch) throw new BrokerUnavailableError();
    await publishConfirmed(ch, this.topology.exchanges.events, event.type, Buffer.from(JSON.stringify(this.factory.toEnvelope(event))), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.id,
      type: event.type,
      timestamp: Math.floor(event.occurredAt.getTime() / 1000),
      appId: 'noshy-backend',
      headers: { 'x-stream-id': event.streamId, 'x-stream-version': event.version },
    });
  }
}
```


El mensaje es un `EventEnvelope`:

```json
{
  "schema": "noshy.event/v1",
  "eventId": "evt_…",
  "type": "comment.created",
  "streamId": "usr_…",
  "version": 12,
  "userId": "usr_…",
  "occurredAt": "2026-11-25T15:04:05.000Z",
  "payload": { "userId": "usr_…", "recipeId": "rcp_…", "commentId": "cmt_…", "recipeAuthorId": "usr_…" }
}
```

## Procesar

📄 [`src/infrastructure/event-bus/rabbitmq/rabbitmq-event-consumer.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq-event-consumer.ts#L9-L131) · líneas 9–131

```ts
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
```


| Resultado | Qué pasa con el mensaje |
| --- | --- |
| Todos los observers terminan | `ack` |
| Falla un observer | Se copia a la cola de espera que toca y `ack`. Al volver, los que ya terminaron se saltan |
| Agotó los reintentos | `nack` sin requeue → `noshy.dlx` → `noshy.dead-letters` |
| No se puede leer (JSON, esquema o tipo desconocido) | `nack` sin requeue → dead letters |
| No hay canal para publicar el reintento | `nack` con requeue |

El número de intento viaja en el header `x-noshy-attempt` y el último error en `x-noshy-last-error`.

## El transporte

Une conexión, publicador y consumidor detrás de `EventTransport`.

📄 [`src/infrastructure/event-bus/rabbitmq/rabbitmq.transport.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq.transport.ts#L6-L35) · líneas 6–35

```ts
export class RabbitMqTransport implements EventTransport {
  readonly kind = 'rabbitmq' as const;

  constructor(
    private readonly conn: RabbitMqConnection,
    readonly dispatcher: RabbitMqEventPublisher,
    private readonly consumer: RabbitMqEventConsumer,
  ) {}

  startConsuming() {
    return this.consumer.start();
  }

  stopConsuming() {
    return this.consumer.stop();
  }

  settle(timeoutMs?: number) {
    return this.consumer.settle(timeoutMs);
  }

  healthy() {
    return this.conn.connected;
  }

  async close() {
    await this.consumer.stop().catch(() => undefined);
    await this.conn.close();
  }
}
```


## Contenedores

📄 [`docker-compose.yml`](../docker-compose.yml#L49-L63) · líneas 49–63

```yaml
  worker:
    build: . # misma imagen que la API (sale de la caché); evita que compose intente descargarla
    image: noshy-backend-dev
    container_name: noshy-worker
    restart: unless-stopped
    command: ["node_modules/.bin/tsx", "watch", "src/entrypoints/worker.ts"]
    volumes:
      - ./src:/app/src:ro
      - noshy-storage:/app/.storage
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: postgres://noshy:${POSTGRES_PASSWORD:-noshy}@postgres:5432/noshy
      RABBITMQ_URL: amqp://${RABBITMQ_USER:-noshy}:${RABBITMQ_PASSWORD:-noshy}@rabbitmq:5672
```

📄 [`docker-compose.yml`](../docker-compose.yml#L87-L104) · líneas 87–104

```yaml
  rabbitmq:
    image: rabbitmq:4-management
    container_name: noshy-rabbitmq
    restart: unless-stopped
    ports:
      - "127.0.0.1:5672:5672"   # AMQP
      - "127.0.0.1:15672:15672" # panel web, solo desde el propio equipo: http://localhost:15672
    environment:
      # No se usa "guest": RabbitMQ solo lo deja conectar desde localhost y la API corre en otro contenedor.
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-noshy}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:-noshy}
    volumes:
      - noshy-rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
```


## Variables

📄 [`src/infrastructure/config/env.ts`](../src/infrastructure/config/env.ts#L50-L72) · líneas 50–72

```ts
  /**
   * Eventos. Con RABBITMQ_URL el transporte es RabbitMQ (el de producción); sin ella, en proceso.
   * EVENT_TRANSPORT lo fuerza (`in-process` sirve para tests o una sola máquina sin broker).
   */
  EVENT_TRANSPORT: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['rabbitmq', 'in-process']).optional()),
  RABBITMQ_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().regex(/^amqps?:\/\//i, 'RABBITMQ_URL debe empezar con amqp:// o amqps://').optional(),
  ),
  /** Prefijo de exchanges y colas (`noshy.events`, `noshy.events.observers`, `noshy.dlx`…). */
  RABBITMQ_PREFIX: z.string().regex(/^[a-z0-9_.-]+$/i).default('noshy'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(20),
  /** Esperas entre reintentos de un observer que falla; después del último va a dead letters. */
  RABBITMQ_RETRY_DELAYS_MS: z
    .string()
    .default('5000,30000,120000,600000')
    .transform((s) => s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0)),

  /** true: este proceso también consume eventos y corre el scheduler (modo de una sola máquina). */
  RUN_WORKERS: bool.default(true),
  RATE_LIMIT_ENABLED: bool.default(true),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
```


## Operación

```bash
docker exec noshy-rabbitmq rabbitmqctl list_queues name messages consumers
docker exec noshy-rabbitmq rabbitmqctl list_bindings
docker compose logs -f worker
```

Panel web: `http://localhost:15672`, solo desde el propio servidor.
