import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainEvent } from './domain-event';
import { DomainEventFactory } from './domain-event.factory';
import { InMemoryEventStore } from './in-memory-event-store';
import { IdempotentObserver, type Observer } from './observer';
import { OutboxRelay } from './outbox-relay';
import { replayEvents } from './replay';
import { Subject, SubjectRegistry } from './subject';

class CountedEvent extends DomainEvent<{ userId: string; n: number }> {
  static readonly eventName = 'test.counted';
}

const factory = () => new DomainEventFactory([CountedEvent]);
const quietRelay = (store: InMemoryEventStore, observers: Observer[], maxAttempts = 3) =>
  new OutboxRelay(store, factory(), new SubjectRegistry(observers), { maxAttempts, onError: () => undefined });

class SumObserver extends IdempotentObserver {
  total = 0;
  protected handle(event: DomainEvent<any>) {
    this.total += event.payload.n;
  }
  protected clearState() {
    this.total = 0;
  }
}

test('append stores events and outbox messages together, with per-stream versions', () => {
  const store = new InMemoryEventStore();
  store.append([new CountedEvent({ userId: 'a', n: 1 }), new CountedEvent({ userId: 'b', n: 1 }), new CountedEvent({ userId: 'a', n: 2 })]);

  assert.deepEqual(store.readStream('a').map((record) => record.version), [1, 2]);
  assert.deepEqual(store.readStream('b').map((record) => record.version), [1]);
  assert.equal(store.readAll().length, 3);
  assert.equal(store.outboxMessages().length, 3);
  assert.ok(store.outboxMessages().every((message) => message.status === 'pending'));
});

test('stored payloads are immutable snapshots', () => {
  const store = new InMemoryEventStore();
  const payload = { userId: 'a', n: 1 };
  store.append([new CountedEvent(payload)]);
  payload.n = 999;

  assert.equal((store.readStream('a')[0].payload as { n: number }).n, 1);
});

test('relay delivers pending messages to the observers and marks them dispatched', async () => {
  const store = new InMemoryEventStore();
  const observer = new SumObserver();
  store.append([new CountedEvent({ userId: 'a', n: 2 }), new CountedEvent({ userId: 'b', n: 3 })]);

  const result = await quietRelay(store, [observer]).drain();

  assert.deepEqual(result, { dispatched: 2, failed: 0 });
  assert.equal(observer.total, 5);
  assert.ok(store.outboxMessages().every((message) => message.status === 'dispatched'));
  assert.deepEqual(await quietRelay(store, [observer]).drain(), { dispatched: 0, failed: 0 });
});

test('a failing observer leaves the message pending, retries, and is idempotent for observers that succeeded', async () => {
  const store = new InMemoryEventStore();
  const healthy = new SumObserver();
  let failures = 1;
  const flaky: Observer = {
    update: () => {
      if (failures-- > 0) throw new Error('temporal');
    }
  };
  store.append([new CountedEvent({ userId: 'a', n: 5 })]);
  const relay = quietRelay(store, [healthy, flaky]);

  assert.deepEqual(await relay.drain(), { dispatched: 0, failed: 1 });
  assert.equal(store.outboxMessages()[0].status, 'pending');
  assert.equal(store.outboxMessages()[0].attempts, 1);

  assert.deepEqual(await relay.drain(), { dispatched: 1, failed: 0 });
  assert.equal(store.outboxMessages()[0].status, 'dispatched');
  assert.equal(healthy.total, 5, 'el observer sano vio el evento dos veces pero lo aplicó una sola');
});

test('a message that keeps failing ends up dead after maxAttempts', async () => {
  const store = new InMemoryEventStore();
  store.append([new CountedEvent({ userId: 'a', n: 1 })]);
  const relay = quietRelay(store, [{ update: () => { throw new Error('siempre'); } }], 2);

  await relay.drain();
  await relay.drain();
  await relay.drain();

  const [message] = store.outboxMessages();
  assert.equal(message.status, 'dead');
  assert.equal(message.attempts, 2);
  assert.match(message.lastError ?? '', /observer/);
});

test('a failure blocks later events of the same user but not other users', async () => {
  const store = new InMemoryEventStore();
  const seen: string[] = [];
  let fail = true;
  const observer: Observer = {
    update: (event, userId) => {
      if (userId === 'a' && event.payload.n === 1 && fail) {
        fail = false;
        throw new Error('primera vez');
      }
      seen.push(`${userId}:${event.payload.n}`);
    }
  };
  store.append([new CountedEvent({ userId: 'a', n: 1 }), new CountedEvent({ userId: 'a', n: 2 }), new CountedEvent({ userId: 'b', n: 1 })]);
  const relay = quietRelay(store, [observer]);

  await relay.drain();
  assert.deepEqual(seen, ['b:1']);

  await relay.drain();
  assert.deepEqual(seen, ['b:1', 'a:1', 'a:2']);
});

test('replay rebuilds a projection from the event history', async () => {
  const store = new InMemoryEventStore();
  store.append([new CountedEvent({ userId: 'a', n: 4 }), new CountedEvent({ userId: 'b', n: 6 })]);

  const rebuilt = new SumObserver();
  const count = await replayEvents(store, factory(), [rebuilt]);
  assert.equal(count, 2);
  assert.equal(rebuilt.total, 10);

  rebuilt.reset();
  await replayEvents(store, factory(), [rebuilt], 'a');
  assert.equal(rebuilt.total, 4);
});

test('factory rebuilds the right event class and rejects unknown types', () => {
  const store = new InMemoryEventStore();
  const [record] = store.append([new CountedEvent({ userId: 'a', n: 1 })]);

  const event = factory().create(record);
  assert.ok(event instanceof CountedEvent);
  assert.equal(event.eventId, record.eventId);
  assert.throws(() => factory().create({ ...record, type: 'nope' }), /desconocido/);
  assert.throws(() => factory().register(CountedEvent), /duplicado/);
});

test('subject supports attach/detach without duplicates', async () => {
  const subject = new Subject('a');
  const calls: number[] = [];
  const observer: Observer = { update: () => void calls.push(1) };
  subject.attach(observer);
  subject.attach(observer);

  await subject.notify(new CountedEvent({ userId: 'a', n: 1 }));
  subject.detach(observer);
  await subject.notify(new CountedEvent({ userId: 'a', n: 1 }));

  assert.equal(calls.length, 1);
});
