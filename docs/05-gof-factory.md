# 05 · GoF Factory

Quien usa un objeto no decide qué clase concreta crear ni cómo se arma: lo pide a una fábrica y recibe una interfaz.

| Fábrica | Crea | Decide según | Variante | Archivo |
| --- | --- | --- | --- | --- |
| `DomainEventFactory` | `DomainEvent`, `StoredEvent` | De dónde viene: caso de uso, base o mensaje | Simple Factory (varios métodos de creación) | [`src/core/events/domain-event.factory.ts`](../src/core/events/domain-event.factory.ts) |
| `EventTransportFactory` | `EventTransport` | `EVENT_TRANSPORT`, `RABBITMQ_URL` | Factory Method parametrizado | [`src/infrastructure/event-bus/event-transport.factory.ts`](../src/infrastructure/event-bus/event-transport.factory.ts) |
| `ProviderFactory` | Familia de servicios externos | Variables de entorno | Cercana a Abstract Factory: una familia de productos detrás de interfaces | [`src/infrastructure/providers.factory.ts`](../src/infrastructure/providers.factory.ts) |

En las tres, la elección se hace con condiciones dentro de la fábrica, no con subclases de la fábrica.

## 1. DomainEventFactory

El único lugar donde nace un evento. Valida el tipo contra el catálogo, copia el payload y lo congela.

| Método | Entrada | Lo usa |
| --- | --- | --- |
| `create` | Tipo y payload | `Outbox.record` |
| `withVersion` | Evento, versión y posición | `PostgresEventStore.append` |
| `fromRow` | Fila de `event_store` | `OutboxRelay`, replay |
| `toEnvelope` | Evento | `RabbitMqEventPublisher` |
| `fromEnvelope` | Mensaje de RabbitMQ | `RabbitMqEventConsumer` |

📄 [`src/core/events/domain-event.factory.ts`](../src/core/events/domain-event.factory.ts#L1-L136) · líneas 1–136

```ts
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
```


Dónde se usa al emitir:

📄 [`src/core/events/outbox.ts`](../src/core/events/outbox.ts#L25-L27) · líneas 25–27

```ts
  async record<T extends EventType>(exec: Executor, type: T, payload: EventPayloads[T]): Promise<StoredEvent<T>> {
    const [stored] = await this.store.append(exec, [this.factory.create(type, payload)]);
    return stored as StoredEvent<T>;
```


## 2. EventTransportFactory

RabbitMQ o en proceso. El resto solo conoce [`EventTransport`](02-event-driven.md#el-puerto).

📄 [`src/infrastructure/event-bus/event-transport.factory.ts`](../src/infrastructure/event-bus/event-transport.factory.ts#L1-L49) · líneas 1–49

```ts
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
```


Dónde se usa:

📄 [`src/container.ts`](../src/container.ts#L50-L50) · líneas 50–50

```ts
  const transport = await new EventTransportFactory(env, log).create({ subjects, factory: eventFactory });
```


## 3. ProviderFactory

| Producto (interfaz) | Implementaciones | Variable |
| --- | --- | --- |
| `Storage` | `LocalStorage` | `STORAGE_DRIVER` |
| `ReceiptParser` | `MockReceiptParser`, `NoneReceiptParser` | `RECEIPT_PARSER` |
| `ChefEngine` | `LlmChefEngine`, `RuleBasedChefEngine` | `CHEF_ENGINE`, `OPENROUTER_API_KEY` |
| `Moderation` | `BasicModeration` | — |
| `OAuthVerifier` | `JwksOAuthVerifier` | `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS` |
| `Notifier` | `LogNotifier` | — |
| `Mailer` | `LogMailer` | — |
| `NutritionEstimator` | `RuleBasedNutritionEstimator` | — |

📄 [`src/infrastructure/providers.factory.ts`](../src/infrastructure/providers.factory.ts#L1-L99) · líneas 1–99

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config/env.js';
import { LocalStorage, type Storage } from './storage/storage.js';
import { MockReceiptParser, NoneReceiptParser, type ReceiptParser } from '../modules/receipts/receipts.providers.js';
import { BasicModeration, type Moderation } from '../modules/community/community.providers.js';
import { JwksOAuthVerifier, type OAuthVerifier } from '../modules/auth/auth.providers.js';
import { LogNotifier, type Notifier } from '../modules/notifications/notifications.providers.js';
import { LlmChefEngine, RuleBasedChefEngine, type ChefEngine } from '../modules/chef/chef.providers.js';
import { DEFAULT_OPENROUTER_MODELS, OpenRouterClient } from './ai/openrouter.client.js';
import { LogMailer, type Mailer } from '../modules/account/account.providers.js';
import { RuleBasedNutritionEstimator, type NutritionEstimator } from '../modules/recipes/recipes.providers.js';

export type Providers = {
  storage: Storage;
  receiptParser: ReceiptParser;
  moderation: Moderation;
  oauth: OAuthVerifier;
  notifier: Notifier;
  chefEngine: ChefEngine;
  mailer: Mailer;
  nutritionEstimator: NutritionEstimator;
};


/**
 * GoF Factory de los servicios externos. Cada método decide la implementación según el entorno;
 * los servicios solo ven la interfaz. Los tests reemplazan cualquiera con `overrides`.
 */
export class ProviderFactory {
  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  createAll(overrides: Partial<Providers> = {}): Providers {
    return {
      storage: overrides.storage ?? this.storage(),
      receiptParser: overrides.receiptParser ?? this.receiptParser(),
      moderation: overrides.moderation ?? this.moderation(),
      oauth: overrides.oauth ?? this.oauth(),
      notifier: overrides.notifier ?? this.notifier(),
      chefEngine: overrides.chefEngine ?? this.chefEngine(),
      mailer: overrides.mailer ?? this.mailer(),
      nutritionEstimator: overrides.nutritionEstimator ?? this.nutritionEstimator(),
    };
  }

  storage(): Storage {
    switch (this.env.STORAGE_DRIVER) {
      case 'local':
        return new LocalStorage(this.env.STORAGE_DIR, `${this.env.PUBLIC_BASE_URL}/api/v1`, this.env.UPLOAD_SIGNING_SECRET);
    }
  }

  receiptParser(): ReceiptParser {
    return this.env.RECEIPT_PARSER === 'mock' ? new MockReceiptParser() : new NoneReceiptParser();
  }

  moderation(): Moderation {
    return new BasicModeration();
  }

  oauth(): OAuthVerifier {
    return new JwksOAuthVerifier({ google: this.env.GOOGLE_CLIENT_IDS, apple: this.env.APPLE_CLIENT_IDS });
  }

  notifier(): Notifier {
    return new LogNotifier(this.log);
  }

  mailer(): Mailer {
    return new LogMailer(this.log);
  }

  nutritionEstimator(): NutritionEstimator {
    return new RuleBasedNutritionEstimator();
  }

  /** `openrouter` si hay API key (o `CHEF_ENGINE=openrouter`); el LLM siempre cae al motor de reglas si falla. */
  chefEngine(): ChefEngine {
    const rules = new RuleBasedChefEngine();
    const { CHEF_ENGINE, OPENROUTER_API_KEY, OPENROUTER_MODEL } = this.env;
    const wantsLlm = CHEF_ENGINE === 'openrouter' || (CHEF_ENGINE === undefined && !!OPENROUTER_API_KEY);
    if (!wantsLlm) {
      this.log.warn('chef: motor de reglas (sin OPENROUTER_API_KEY o CHEF_ENGINE=rules); no responde con IA');
      return rules;
    }
    if (!OPENROUTER_API_KEY) {
      this.log.warn('CHEF_ENGINE=openrouter sin OPENROUTER_API_KEY: uso el motor de reglas');
      return rules;
    }
    this.log.info({ models: this.models() }, 'chef: OpenRouter');
    return new LlmChefEngine(new OpenRouterClient(OPENROUTER_API_KEY, this.models(), this.log), rules, this.log);
  }

  private models() {
    return this.env.OPENROUTER_MODEL.length ? this.env.OPENROUTER_MODEL : DEFAULT_OPENROUTER_MODELS;
  }
}
```


Dónde se usa. `overrides` permite a las pruebas reemplazar cualquiera:

📄 [`src/container.ts`](../src/container.ts#L54-L54) · líneas 54–54

```ts
  const providers: Providers = new ProviderFactory(env, log).createAll(overrides);
```
