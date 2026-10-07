// Prueba de punta a punta contra un RabbitMQ real. Se salta si no hay RABBITMQ_URL.
//   pnpm rabbit:up
//   $env:RABBITMQ_URL='amqp://guest:guest@localhost:5672'; pnpm exec tsx --test src/infrastructure/event-bus/rabbitmq/rabbitmq.live.test.ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { InMemoryEventStore } from '../../../core/events/in-memory-event-store';
import { createCommandBus } from '../command-bus';
import { setEventStore } from '../event-bus';
import { createOutboxRelay, eventFactory } from '../register-observers';
import { SubjectRegistry } from '../../../core/events/subject';
import { RecommendationEngine } from '../../../modules/recommendations/events/recommendations.observers';
import { CommunityNotificationEngine } from '../../../modules/recipes/events/recipes.observers';
import { RabbitMqCommandClient } from './rabbitmq-command-client';
import { RabbitMqCommandConsumer } from './rabbitmq-command-consumer';
import { RabbitMqEventConsumer } from './rabbitmq-event-consumer';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';
import { RabbitMqConnection } from './rabbitmq.connection';

const url = process.env.RABBITMQ_URL;
const skip = url ? false : 'RABBITMQ_URL no definido';

let rabbit: RabbitMqConnection;
let commandConsumer: RabbitMqCommandConsumer;
let eventConsumer: RabbitMqEventConsumer;
let client: RabbitMqCommandClient;
const store = new InMemoryEventStore();
const recommendations = new RecommendationEngine();
const community = new CommunityNotificationEngine();
// Exchanges y colas temporales propios: el test no toca noshy.commands / noshy.events, así que ni le roba
// mensajes a una API o worker corriendo ni les deja mensajes de prueba en sus colas.
const runId = randomUUID();
const commandExchange = `test.commands.${runId}`;
const eventExchange = `test.events.${runId}`;
const commandQueue = `test.commands.q.${runId}`;
const eventQueue = `test.events.q.${runId}`;

before(async () => {
  if (!url) return;
  setEventStore(store);
  rabbit = await RabbitMqConnection.connect(url);
  await rabbit.channel.assertExchange(commandExchange, 'topic', { autoDelete: true });
  await rabbit.channel.assertExchange(eventExchange, 'topic', { autoDelete: true });
  await rabbit.channel.assertQueue(commandQueue, { exclusive: true, autoDelete: true });
  await rabbit.channel.bindQueue(commandQueue, commandExchange, '#');
  await rabbit.channel.assertQueue(eventQueue, { exclusive: true, autoDelete: true });
  await rabbit.channel.bindQueue(eventQueue, eventExchange, '#');

  commandConsumer = new RabbitMqCommandConsumer(rabbit.channel, createCommandBus(), commandQueue);
  eventConsumer = new RabbitMqEventConsumer(rabbit.channel, eventFactory, new SubjectRegistry([recommendations, community]), eventQueue);
  await commandConsumer.start();
  await eventConsumer.start();
  client = new RabbitMqCommandClient(await rabbit.createChannel(), commandExchange);
});

after(async () => {
  if (!url) return;
  await commandConsumer.stop();
  await eventConsumer.stop();
  await rabbit.close();
});

const waitFor = async (check: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando a RabbitMQ');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

test('RPC: a command sent through RabbitMQ runs the same handler and returns its result', { skip }, async () => {
  const reply = await client.send('inventory.add', { userId: 'live-user', data: { name: 'Arroz', quantity: 1, unit: 'kg' } });

  assert.equal(reply.status, 'handled');
  assert.equal((reply as { result: { name: string } }).result.name, 'Arroz');
  assert.deepEqual(store.readStream('live-user').map((record) => record.type), ['inventory.item_added']);
});

test('the same DTO rejects bad data over RabbitMQ', { skip }, async () => {
  const reply = await client.send('inventory.add', { userId: 'live-user', data: { name: '' } });
  assert.equal(reply.status, 'invalid');
});

test('outbox -> noshy.events -> worker observers, end to end', { skip }, async () => {
  const relay = createOutboxRelay(store, new RabbitMqEventPublisher(rabbit.confirmChannel, eventExchange));
  const created = await client.send('recipes.create', {
    userId: 'live-chef',
    data: { title: 'Pozole', ingredients: [{ name: 'Maíz', quantity: 1, unit: 'kg' }], instructions: ['Hervir'] }
  });
  const recipeId = (created as { result: { id: string } }).result.id;
  await client.send('recipes.publish', { userId: 'live-chef', params: { recipeId, authorName: 'Chef' } });

  await relay.drainAll();
  await waitFor(() => community.feed().some((entry) => entry.recipeId === recipeId));

  assert.ok(store.outboxMessages().every((message) => message.status === 'dispatched'));
});
