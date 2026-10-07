// Adaptadores de RabbitMQ contra un canal falso: verifica ack / nack / reply sin necesitar un broker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Channel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import { CommandBus, defineHandler } from '../../../core/commands/command-bus';
import { DomainEvent } from '../../../core/events/domain-event';
import { DomainEventFactory } from '../../../core/events/domain-event.factory';
import type { EventDispatcher } from '../../../core/events/subject';
import { RabbitMqCommandConsumer } from './rabbitmq-command-consumer';
import { RabbitMqEventConsumer } from './rabbitmq-event-consumer';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';
import { Exchanges, toBuffer } from './topology';

class PingEvent extends DomainEvent<{ userId: string; n: number }> {
  static readonly eventName = 'test.ping';
}

class FakeChannel {
  readonly published: { exchange: string; routingKey: string; body: any; options: any }[] = [];
  readonly sent: { queue: string; body: any; options: any }[] = [];
  readonly acked: ConsumeMessage[] = [];
  readonly nacked: { message: ConsumeMessage; requeue: boolean }[] = [];
  confirmError: Error | null = null;

  publish(exchange: string, routingKey: string, content: Buffer, options: any, callback?: (error: unknown) => void) {
    this.published.push({ exchange, routingKey, body: JSON.parse(content.toString()), options });
    callback?.(this.confirmError);
    return true;
  }
  sendToQueue(queue: string, content: Buffer, options: any) {
    this.sent.push({ queue, body: JSON.parse(content.toString()), options });
    return true;
  }
  ack(message: ConsumeMessage) {
    this.acked.push(message);
  }
  nack(message: ConsumeMessage, _allUpTo: boolean, requeue: boolean) {
    this.nacked.push({ message, requeue });
  }
}

const message = (routingKey: string, body: unknown, properties: Record<string, unknown> = {}, redelivered = false) =>
  ({
    content: toBuffer(body),
    fields: { routingKey, redelivered, deliveryTag: 1, exchange: '', consumerTag: 'c' },
    properties: { headers: {}, ...properties }
  }) as unknown as ConsumeMessage;

const bus = () =>
  new CommandBus().register(
    defineHandler({ name: 'math.double', schema: z.object({ n: z.number() }), execute: ({ userId, data }) => ({ userId, value: data.n * 2 }) }),
    defineHandler({
      name: 'math.fail',
      requiresUser: false,
      execute: () => {
        throw new Error('boom');
      }
    })
  );

test('publisher sends the event to noshy.events with eventName as routing key and resolves on broker confirm', async () => {
  const channel = new FakeChannel();
  const event = new PingEvent({ userId: 'u1', n: 3 });

  await new RabbitMqEventPublisher(channel as unknown as ConfirmChannel).dispatch(event);

  const [sent] = channel.published;
  assert.equal(sent.exchange, Exchanges.events);
  assert.equal(sent.routingKey, 'test.ping');
  assert.equal(sent.options.messageId, event.eventId);
  assert.equal(sent.options.persistent, true);
  assert.deepEqual(sent.body.payload, { userId: 'u1', n: 3 });
});

test('publisher rejects when the broker does not confirm (the outbox will retry)', async () => {
  const channel = new FakeChannel();
  channel.confirmError = new Error('nack del broker');

  await assert.rejects(new RabbitMqEventPublisher(channel as unknown as ConfirmChannel).dispatch(new PingEvent({ userId: 'u1', n: 1 })), /nack/);
});

test('command consumer runs the handler, replies to replyTo with the outcome and acks', async () => {
  const channel = new FakeChannel();
  const consumer = new RabbitMqCommandConsumer(channel as unknown as Channel, bus());

  await consumer.onMessage(message('math.double', { userId: 'u1', data: { n: 21 } }, { replyTo: 'reply-q', correlationId: 'c1', messageId: 'm1' }));

  assert.deepEqual(channel.sent[0], {
    queue: 'reply-q',
    body: { status: 'handled', result: { userId: 'u1', value: 42 } },
    options: { contentType: 'application/json', correlationId: 'c1' }
  });
  assert.equal(channel.acked.length, 1);
});

test('fire-and-forget: an invalid message goes to dead letters instead of looping', async () => {
  const channel = new FakeChannel();
  const consumer = new RabbitMqCommandConsumer(channel as unknown as Channel, bus());

  await consumer.onMessage(message('math.double', { userId: 'u1', data: { n: 'x' } }));
  await consumer.onMessage(message('does.not.exist', {}));

  assert.deepEqual(channel.nacked.map((entry) => entry.requeue), [false, false]);
  assert.equal(channel.acked.length, 0);
});

test('a throwing handler is retried once, then dead-lettered', async () => {
  const channel = new FakeChannel();
  const consumer = new RabbitMqCommandConsumer(channel as unknown as Channel, bus());

  await consumer.onMessage(message('math.fail', {}, {}, false));
  await consumer.onMessage(message('math.fail', {}, {}, true));

  assert.deepEqual(channel.nacked.map((entry) => entry.requeue), [true, false]);
});

test('event consumer rebuilds the event class and hands it to the dispatcher (observers)', async () => {
  const channel = new FakeChannel();
  const received: DomainEvent<any>[] = [];
  const dispatcher: EventDispatcher = { dispatch: async (event) => void received.push(event) };
  const consumer = new RabbitMqEventConsumer(channel as unknown as Channel, new DomainEventFactory([PingEvent]), dispatcher);

  await consumer.onMessage(message('test.ping', { eventId: 'e1', name: 'test.ping', userId: 'u1', payload: { userId: 'u1', n: 5 }, occurredAt: new Date().toISOString() }));

  assert.ok(received[0] instanceof PingEvent);
  assert.equal(received[0].eventId, 'e1');
  assert.equal(channel.acked.length, 1);
});

test('event consumer requeues once on failure, then dead-letters', async () => {
  const channel = new FakeChannel();
  const dispatcher: EventDispatcher = {
    dispatch: async () => {
      throw new Error('observer caído');
    }
  };
  const consumer = new RabbitMqEventConsumer(channel as unknown as Channel, new DomainEventFactory([PingEvent]), dispatcher);
  const body = { eventId: 'e1', name: 'test.ping', userId: 'u1', payload: { userId: 'u1', n: 1 }, occurredAt: new Date().toISOString() };

  await consumer.onMessage(message('test.ping', body, {}, false));
  await consumer.onMessage(message('test.ping', body, {}, true));

  assert.deepEqual(channel.nacked.map((entry) => entry.requeue), [true, false]);
});
