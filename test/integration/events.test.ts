import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pino from 'pino';
import { connect } from 'amqplib';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { createPostgres, type Postgres } from '../../src/infrastructure/database/postgres/postgres.client.js';
import { DomainEventFactory, MalformedEventError, UnknownEventTypeError } from '../../src/core/events/domain-event.factory.js';
import { EventTransportFactory, resolveTransportKind } from '../../src/infrastructure/event-bus/event-transport.factory.js';
import { PostgresEventStore } from '../../src/core/events/event-store.js';
import { Outbox, OutboxRelay } from '../../src/core/events/outbox.js';
import { ProcessedEventsLedger } from '../../src/core/events/ledger.js';
import { ObserversFailedError, SubjectRegistry } from '../../src/core/events/subject.js';
import { EventObserver, type ReplayableObserver } from '../../src/core/events/observer.js';
import { replayEvents } from '../../src/core/events/replay.js';
import type { DomainEvent } from '../../src/core/events/domain-event.js';
import type { EventDispatcher } from '../../src/core/events/transport.js';
import { loadEnv } from '../../src/infrastructure/config/env.js';
import { TEST_DB_URL, TEST_RABBITMQ_URL, resetDatabases } from '../e2e/helpers.js';

const log = pino({ level: process.env.TLOG ?? 'silent' }) as unknown as FastifyBaseLogger;
const factory = new DomainEventFactory();
let pg: Postgres;
let store: PostgresEventStore;
let outbox: Outbox;

/** Observer de prueba: cuenta lo que ve y puede fallar a voluntad. */
class Probe extends EventObserver implements ReplayableObserver {
  readonly replayable = true as const;
  seen: string[] = [];
  failTimes = 0;
  constructor(readonly name: string) {
    super();
    this.onEach(['pantry.items_added', 'recipe.liked'], async (e) => {
      if (this.failTimes > 0) {
        this.failTimes--;
        throw new Error(`${this.name} falló a propósito`);
      }
      this.seen.push(`${e.streamId}:${e.version}:${e.type}`);
    });
  }
  async reset() {
    this.seen = [];
  }
}

const liked = (userId: string, n = 1) => ({ userId, recipeId: `rcp_${n}`, liked: true });

beforeAll(async () => {
  await resetDatabases();
  pg = createPostgres(TEST_DB_URL);
  store = new PostgresEventStore(pg.db, factory);
  outbox = new Outbox(pg.db, store, factory);
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.db.execute(sql`truncate event_store, outbox, processed_events restart identity cascade`);
});

describe('Factory de eventos', () => {
  it('crea eventos inmutables con stream del usuario y rechaza tipos desconocidos', () => {
    const payload = { userId: 'usr_a', recipeId: 'rcp_1', liked: true };
    const e = factory.create('recipe.liked', payload);
    payload.liked = false;
    expect(e).toMatchObject({ type: 'recipe.liked', streamId: 'usr_a', userId: 'usr_a', version: 0, payload: { liked: true } });
    expect(Object.isFrozen(e) && Object.isFrozen(e.payload)).toBe(true);
    expect(() => factory.create('nope' as never, {} as never)).toThrow(UnknownEventTypeError);
  });

  it('serializa y rehidrata el sobre de RabbitMQ; rechaza sobres mal formados', () => {
    const e = factory.create('recipe.liked', liked('usr_a'));
    const back = factory.fromEnvelope(JSON.parse(JSON.stringify(factory.toEnvelope(e))));
    expect(back).toEqual(e);
    expect(() => factory.fromEnvelope({ eventId: 'x' })).toThrow(MalformedEventError);
    expect(() => factory.fromEnvelope({ ...factory.toEnvelope(e), type: 'otro.evento' })).toThrow(UnknownEventTypeError);
  });

  it('elige RabbitMQ cuando hay RABBITMQ_URL', () => {
    expect(resolveTransportKind({ RABBITMQ_URL: 'amqp://x', EVENT_TRANSPORT: undefined })).toBe('rabbitmq');
    expect(resolveTransportKind({ RABBITMQ_URL: undefined, EVENT_TRANSPORT: undefined })).toBe('in-process');
    expect(resolveTransportKind({ RABBITMQ_URL: 'amqp://x', EVENT_TRANSPORT: 'in-process' })).toBe('in-process');
  });
});

describe('Event store + outbox', () => {
  it('versiona por stream y escribe evento y outbox en la misma transacción', async () => {
    await pg.db.transaction(async (tx) => {
      await outbox.record(tx, 'recipe.liked', liked('usr_a', 1));
      await outbox.record(tx, 'recipe.liked', liked('usr_b', 1));
      await outbox.record(tx, 'recipe.liked', liked('usr_a', 2));
    });
    expect((await store.readStream('usr_a')).map((e) => e.version)).toEqual([1, 2]);
    expect((await store.readStream('usr_b')).map((e) => e.version)).toEqual([1]);
    const pending = await pg.db.execute<{ n: number }>(sql`select count(*)::int n from outbox where status = 'pending'`);
    expect(pending.rows[0]!.n).toBe(3);
  });

  it('si la transacción se deshace, no queda ni el evento ni su entrega', async () => {
    await expect(
      pg.db.transaction(async (tx) => {
        await outbox.record(tx, 'recipe.liked', liked('usr_a'));
        throw new Error('el caso de uso falló');
      }),
    ).rejects.toThrow('el caso de uso falló');
    expect(await store.readAll()).toHaveLength(0);
    expect((await pg.db.execute(sql`select 1 from outbox`)).rows).toHaveLength(0);
  });

  it('transacciones concurrentes del mismo usuario se ordenan sin conflictos de versión', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => pg.db.transaction((tx) => outbox.record(tx, 'recipe.liked', liked('usr_c', i)))));
    expect((await store.readStream('usr_c')).map((e) => e.version)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('es append-only: un UPDATE falla; purgar un usuario deja solo la lápida', async () => {
    await outbox.publish('recipe.liked', liked('usr_d'));
    await outbox.publish('user.deleted', { userId: 'usr_d', storageKeys: [] });
    const err = await pg.db.execute(sql`update event_store set type = 'x'`).catch((e: Error & { cause?: Error }) => e.cause ?? e);
    expect(String((err as Error).message)).toMatch(/append-only/);
    expect(await store.deleteStream(pg.db, 'usr_d', { keepTypes: ['user.deleted'] })).toBe(1);
    expect((await store.readStream('usr_d')).map((e) => e.type)).toEqual(['user.deleted']);
  });
});

describe('Relay del outbox', () => {
  const fakeDispatcher = (fail: (e: DomainEvent) => boolean) => {
    const delivered: string[] = [];
    const d: EventDispatcher = {
      dispatch: async (e) => {
        if (fail(e)) throw new Error('broker caído');
        delivered.push(`${e.streamId}:${e.version}`);
      },
    };
    return { d, delivered };
  };

  it('entrega en orden de escritura y marca como despachado', async () => {
    for (const u of ['usr_a', 'usr_b', 'usr_a']) await outbox.publish('recipe.liked', liked(u));
    const { d, delivered } = fakeDispatcher(() => false);
    expect(await new OutboxRelay(pg.db, factory, d, log).drain()).toBe(3);
    expect(delivered).toEqual(['usr_a:1', 'usr_b:1', 'usr_a:2']);
    expect(await new OutboxRelay(pg.db, factory, d, log).drain()).toBe(0);
  });

  it('una falla bloquea lo siguiente del mismo usuario, no a los demás, y termina en dead', async () => {
    for (const u of ['usr_a', 'usr_a', 'usr_b']) await outbox.publish('recipe.liked', liked(u));
    const { d, delivered } = fakeDispatcher((e) => e.streamId === 'usr_a');
    const relay = new OutboxRelay(pg.db, factory, d, log, { maxAttempts: 2 });
    await relay.drain();
    expect(delivered).toEqual(['usr_b:1']);
    const rows = async () => (await pg.db.execute<{ stream_id: string; status: string; attempts: number }>(sql`select stream_id, status, attempts from outbox order by position`)).rows;
    expect(await rows()).toMatchObject([
      { stream_id: 'usr_a', status: 'pending', attempts: 1 },
      { stream_id: 'usr_a', status: 'pending', attempts: 0 },
      { stream_id: 'usr_b', status: 'dispatched' },
    ]);
    await pg.db.execute(sql`update outbox set next_attempt_at = now()`);
    await relay.drain();
    expect((await rows())[0]).toMatchObject({ status: 'dead', attempts: 2 });
  });
});

describe('Subject / Observer', () => {
  it('cada Subject notifica a los observers interesados; en el reintento salta a los que ya procesaron', async () => {
    const ok = new Probe('probe.ok');
    const flaky = new Probe('probe.flaky');
    flaky.failTimes = 1;
    const subjects = new SubjectRegistry(new ProcessedEventsLedger(pg.db), log);
    subjects.attach(ok);
    subjects.attach(flaky);
    expect(() => subjects.attach(new Probe('probe.ok'))).toThrow(/duplicado/);

    const [e] = await store.append(pg.db, [factory.create('recipe.liked', liked('usr_a'))]);
    await expect(subjects.dispatch(e!)).rejects.toBeInstanceOf(ObserversFailedError);
    await subjects.dispatch(e!);
    await subjects.dispatch(e!); // entrega duplicada: no pasa nada
    expect(ok.seen).toEqual(['usr_a:1:recipe.liked']);
    expect(flaky.seen).toEqual(['usr_a:1:recipe.liked']);

    // No le interesa: no se llama ni se registra.
    const [other] = await store.append(pg.db, [factory.create('user.email_verified', { userId: 'usr_a' })]);
    await subjects.dispatch(other!);
    expect(ok.seen).toHaveLength(1);
  });

  it('serializa los eventos de un mismo usuario aunque lleguen a la vez', async () => {
    const order: number[] = [];
    class Slow extends EventObserver {
      readonly name = 'slow';
      constructor() {
        super();
        this.on('recipe.liked', async (e) => {
          await new Promise((r) => setTimeout(r, e.version === 1 ? 40 : 1));
          order.push(e.version);
        });
      }
    }
    const subjects = new SubjectRegistry(new ProcessedEventsLedger(pg.db), log);
    subjects.attach(new Slow());
    const events = await store.append(pg.db, [factory.create('recipe.liked', liked('usr_s', 1)), factory.create('recipe.liked', liked('usr_s', 2))]);
    await Promise.all(events.map((e) => subjects.dispatch(e)));
    expect(order).toEqual([1, 2]);
  });

  it('replay reconstruye una proyección desde el event store', async () => {
    await outbox.publish('recipe.liked', liked('usr_a'));
    await outbox.publish('pantry.items_added', { userId: 'usr_b', itemIds: [], ingredientIds: [], source: 'manual' });
    await outbox.publish('user.email_verified', { userId: 'usr_a' });
    const p = new Probe('probe.replay');
    p.seen = ['basura'];
    expect(await replayEvents(store, [p], { reset: true })).toBe(2);
    expect(p.seen).toEqual(['usr_a:1:recipe.liked', 'usr_b:1:pantry.items_added']);
    await replayEvents(store, [p], { reset: true, streamId: 'usr_b' });
    expect(p.seen).toEqual(['usr_b:1:pantry.items_added']);
  });
});

const rabbitAvailable = await connect(TEST_RABBITMQ_URL)
  .then(async (c) => {
    await c.close();
    return true;
  })
  .catch(() => false);

describe.skipIf(!rabbitAvailable)('RabbitMQ (broker real)', () => {
  const PREFIX = 'noshy_itest';

  const build = async () => {
    const env = loadEnv({
      DATABASE_URL: TEST_DB_URL,
      MONGO_URL: 'mongodb://unused',
      JWT_SECRET: 'x'.repeat(40),
      RABBITMQ_URL: TEST_RABBITMQ_URL,
      RABBITMQ_PREFIX: PREFIX,
      RABBITMQ_RETRY_DELAYS_MS: '100,200',
    });
    const subjects = new SubjectRegistry(new ProcessedEventsLedger(pg.db), log);
    const transport = await new EventTransportFactory(env, log).create({ subjects, factory });
    const relay = new OutboxRelay(pg.db, factory, transport.dispatcher, log);
    return { subjects, transport, relay };
  };

  const queueDepth = async (queue: string) => {
    const c = await connect(TEST_RABBITMQ_URL);
    const ch = await c.createChannel();
    const n = (await ch.checkQueue(queue)).messageCount;
    await c.close();
    return n;
  };

  const purge = async () => {
    const c = await connect(TEST_RABBITMQ_URL);
    const ch = await c.createChannel();
    ch.on('error', () => undefined);
    for (const q of [`${PREFIX}.events.observers`, `${PREFIX}.dead-letters`, `${PREFIX}.events.retry.100ms`, `${PREFIX}.events.retry.200ms`]) await ch.purgeQueue(q).catch(() => undefined);
    await c.close();
  };

  const waitFor = async (cond: () => Promise<boolean> | boolean, ms = 5_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout esperando condición');
  };

  it('outbox → exchange → cola → Subject → observer, con la topología del backend anterior', async () => {
    const { subjects, transport, relay } = await build();
    await purge();
    const probe = new Probe('probe.rabbit');
    subjects.attach(probe);
    await transport.startConsuming();
    try {
      await outbox.publish('recipe.liked', liked('usr_r'));
      await outbox.publish('pantry.items_added', { userId: 'usr_r', itemIds: [], ingredientIds: [], source: 'manual' });
      expect(await relay.drain()).toBe(2);
      await waitFor(() => probe.seen.length === 2);
      expect(probe.seen).toEqual(['usr_r:1:recipe.liked', 'usr_r:2:pantry.items_added']);
      expect(transport.healthy()).toBe(true);
    } finally {
      await transport.close();
    }
  });

  it('un observer que falla se reintenta por las colas de espera; si nunca funciona termina en dead letters', async () => {
    const { subjects, transport, relay } = await build();
    await purge();
    const flaky = new Probe('probe.flaky.rabbit');
    flaky.failTimes = 2; // falla 2 veces, funciona al 3er intento (hay 2 esperas)
    subjects.attach(flaky);
    await transport.startConsuming();
    try {
      await outbox.publish('recipe.liked', liked('usr_f'));
      await relay.drain();
      await waitFor(() => flaky.seen.length === 1);

      flaky.failTimes = 99;
      await outbox.publish('recipe.liked', liked('usr_f', 2));
      await relay.drain();
      await waitFor(async () => (await queueDepth(`${PREFIX}.dead-letters`)) === 1);
      expect(flaky.seen).toHaveLength(1);
    } finally {
      await transport.close();
    }
  });

  it('un mensaje ilegible va directo a dead letters sin tocar a los observers', async () => {
    const { subjects, transport } = await build();
    await purge();
    const probe = new Probe('probe.garbage');
    subjects.attach(probe);
    await transport.startConsuming();
    try {
      const c = await connect(TEST_RABBITMQ_URL);
      const ch = await c.createConfirmChannel();
      ch.publish(`${PREFIX}.events`, 'recipe.liked', Buffer.from('{"no":"es un evento"}'));
      await ch.waitForConfirms();
      await c.close();
      await waitFor(async () => (await queueDepth(`${PREFIX}.dead-letters`)) === 1);
      expect(probe.seen).toHaveLength(0);
    } finally {
      await transport.close();
    }
  });

  it('sin broker, publicar falla y el evento se queda pendiente en el outbox', async () => {
    const { transport, relay } = await build();
    await transport.close();
    await outbox.publish('recipe.liked', liked('usr_x'));
    expect(await relay.drain()).toBe(0);
    const row = await pg.db.execute<{ status: string; attempts: number; last_error: string }>(sql`select status, attempts, last_error from outbox`);
    expect(row.rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'RabbitMQ no está conectado' });
  });
});
