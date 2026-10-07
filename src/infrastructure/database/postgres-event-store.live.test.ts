// Contra un Postgres real. Se salta si no hay DATABASE_URL.
//   pnpm db:up
//   $env:DATABASE_URL='postgres://noshy:noshy@localhost:5433/noshy'; pnpm exec tsx --test src/infrastructure/database/postgres-event-store.live.test.ts
// Cada corrida usa un schema temporal propio y lo borra al final.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { DomainEvent } from '../../core/events/domain-event';
import { DomainEventFactory } from '../../core/events/domain-event.factory';
import { StreamVersionConflictError } from '../../core/events/event-store';
import { IdempotentObserver, type Observer } from '../../core/events/observer';
import { OutboxRelay } from '../../core/events/outbox-relay';
import { replayEvents } from '../../core/events/replay';
import { SubjectRegistry } from '../../core/events/subject';
import { createPool, withTransaction } from './db.connection';
import { runMigrations } from './migrations';
import { PostgresEventStore } from './postgres-event-store';

class CountedEvent extends DomainEvent<{ userId: string; n: number }> {
  static readonly eventName = 'test.counted';
}

class SumObserver extends IdempotentObserver {
  total = 0;
  protected handle(event: DomainEvent<any>) {
    this.total += event.payload.n;
  }
  protected clearState() {
    this.total = 0;
  }
}

const url = process.env.DATABASE_URL;
const skip = url ? false : 'DATABASE_URL no definido';
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const factory = new DomainEventFactory([CountedEvent]);
let admin: Pool;
let pool: Pool;
let store: PostgresEventStore;

const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
const relayFor = (observers: Observer[], maxAttempts = 3) =>
  new OutboxRelay(store, factory, new SubjectRegistry(observers), { maxAttempts, onError: () => undefined });

before(async () => {
  if (!url) return;
  admin = createPool(url, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool(url, { schema });
  store = new PostgresEventStore(pool);
});

after(async () => {
  if (!url) return;
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('migrations apply once and are idempotent', { skip }, async () => {
  assert.deepEqual(await runMigrations(pool), ['001_event_store_and_outbox', '002_domain_tables']);
  assert.deepEqual(await runMigrations(pool), []);
});

test('append writes events and outbox rows together, with per-stream versions', { skip }, async () => {
  await store.append([new CountedEvent({ userId: 'a', n: 1 }), new CountedEvent({ userId: 'b', n: 1 }), new CountedEvent({ userId: 'a', n: 2 })]);

  assert.deepEqual((await store.readStream('a')).map((record) => record.version), [1, 2]);
  assert.deepEqual((await store.readStream('b')).map((record) => record.version), [1]);
  assert.equal(await count('event_store'), 3);
  assert.equal(await count('outbox'), 3);
});

test('transactional outbox: if the use case fails, neither the event nor its outbox row survive', { skip }, async () => {
  const before = { events: await count('event_store'), outbox: await count('outbox') };

  await assert.rejects(
    withTransaction(pool, async (tx) => {
      await store.append([new CountedEvent({ userId: 'rollback', n: 99 })], tx);
      throw new Error('falló el caso de uso después de escribir');
    }),
    /falló el caso de uso/
  );

  assert.equal(await count('event_store'), before.events);
  assert.equal(await count('outbox'), before.outbox);
  assert.deepEqual(await store.readStream('rollback'), []);
});

test('two concurrent writers on the same stream: the second gets a version conflict', { skip }, async () => {
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    await store.append([new CountedEvent({ userId: 'race', n: 1 })], first);
    const losing = store.append([new CountedEvent({ userId: 'race', n: 2 })], second); // queda esperando el índice único
    await first.query('COMMIT');
    await assert.rejects(losing, StreamVersionConflictError);
    await second.query('ROLLBACK');
  } finally {
    first.release();
    second.release();
  }
  assert.deepEqual((await store.readStream('race')).map((record) => record.version), [1]);
});

test('the OutboxRelay delivers from Postgres and marks rows dispatched; failures retry then go dead', { skip }, async () => {
  const observer = new SumObserver();
  await relayFor([observer]).drainAll();
  assert.equal(observer.total, 1 + 1 + 2 + 1, 'a(1,2) + b(1) + race(1)');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM outbox WHERE status <> 'dispatched'`)).rows[0].count), 0);

  await store.append([new CountedEvent({ userId: 'poison', n: 1 })]);
  const broken = relayFor([{ update: () => { throw new Error('observer caído'); } }], 2);
  await broken.drain();
  await broken.drain();
  const { rows } = await pool.query(`SELECT o.status, o.attempts, o.last_error FROM outbox o JOIN event_store e USING (event_id) WHERE e.stream_id = 'poison'`);
  assert.deepEqual({ status: rows[0].status, attempts: rows[0].attempts }, { status: 'dead', attempts: 2 });
  assert.match(rows[0].last_error, /observer/);
});

test('event sourcing: a projection is rebuilt by replaying the history stored in Postgres', { skip }, async () => {
  const rebuilt = new SumObserver();
  const replayed = await replayEvents(store, factory, [rebuilt]);

  assert.equal(replayed, await count('event_store'));
  assert.equal(rebuilt.total, 1 + 1 + 2 + 1 + 1);
});
