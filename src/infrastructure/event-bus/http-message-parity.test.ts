// Prueba central: HTTP y mensajes pasan por el MISMO CommandBus -> mismos handlers, DTOs y servicios.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { CommandBus, type InboundMessage } from '../../core/commands/command-bus';
import { InMemoryEventStore } from '../../core/events/in-memory-event-store';
import { createServer } from '../http/server';
import { AuthHandlers } from '../../modules/auth/events/auth.handlers';
import { InventoryHandlers } from '../../modules/inventory/events/inventory.handlers';
import { RecipeHandlers } from '../../modules/recipes/events/recipe.handlers';
import { createCommandBus } from './command-bus';
import { setEventStore } from './event-bus';

const store = new InMemoryEventStore();
setEventStore(store);

// Bus espía: registra cada mensaje que le llega y delega en el bus real.
class SpyCommandBus extends CommandBus {
  readonly seen: InboundMessage[] = [];
  constructor(private readonly inner: CommandBus) {
    super();
  }
  override dispatch(message: InboundMessage) {
    this.seen.push(message);
    return this.inner.dispatch(message);
  }
}

const commands = new SpyCommandBus(createCommandBus());

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer({ commandBus: commands }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const json = { 'Content-Type': 'application/json' };
const strip = (value: Record<string, unknown>) => {
  const { id: _id, userId: _userId, createdAt: _createdAt, ...rest } = value;
  return rest;
};

test('HTTP controllers dispatch through the CommandBus instead of calling services', async () => {
  commands.seen.length = 0;
  await withServer(async (baseUrl) => {
    const register = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Spy', email: 'spy@noshy.com', password: 'StrongPass1!' })
    });
    const { token } = await register.json();
    await fetch(`${baseUrl}/recipes`, { headers: { Authorization: `Bearer ${token}` } });
  });

  assert.deepEqual(
    commands.seen.map((message) => message.name),
    [AuthHandlers.register, RecipeHandlers.list]
  );
});

test('registering through HTTP and through a message yields the same result', async () => {
  const credentials = { name: 'Ana', password: 'StrongPass1!' };

  const http = await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ...credentials, email: 'http-parity@noshy.com' })
    });
    return { status: response.status, body: await response.json() };
  });
  const message = await commands.dispatch({ name: AuthHandlers.register, data: { ...credentials, email: 'msg-parity@noshy.com' } });

  assert.equal(http.status, 201);
  assert.equal(message.status, 'handled');
  const result = (message as { result: { ok: boolean; data: { user: { name: string }; token: string } } }).result;
  assert.equal(result.ok, true);
  assert.equal(result.data.user.name, http.body.user.name);
});

test('the same DTO rejects the same bad input with the same issues on both triggers', async () => {
  const badBody = { name: 'A', email: 'no-es-un-email', password: '1' };

  const http = await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(badBody) });
    return { status: response.status, body: await response.json() };
  });
  const message = await commands.dispatch({ name: AuthHandlers.register, data: badBody });

  assert.equal(http.status, 400);
  assert.equal(message.status, 'invalid');
  assert.deepEqual(http.body.issues, JSON.parse(JSON.stringify(message.status === 'invalid' ? message.issues : [])));
});

test('inventory: HTTP and message produce equal items and the same outbound event', async () => {
  const body = { name: 'Arroz', quantity: 2, unit: 'kg' };

  const http = await withServer(async (baseUrl) => {
    const register = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Inv', email: 'inv-http@noshy.com', password: 'StrongPass1!' })
    });
    const { token, user } = await register.json();
    const response = await fetch(`${baseUrl}/inventory/items`, {
      method: 'POST',
      headers: { ...json, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    return { userId: user.id as string, status: response.status, item: await response.json() };
  });

  const message = await commands.dispatch({ name: InventoryHandlers.add, userId: 'msg-inventory-user', data: body });

  assert.equal(http.status, 201);
  assert.equal(message.status, 'handled');
  assert.deepEqual(strip((message as { result: Record<string, unknown> }).result), strip(http.item));
  assert.ok(store.readStream(http.userId).some((record) => record.type === 'inventory.item_added'));
  assert.deepEqual(store.readStream('msg-inventory-user').map((record) => record.type), ['inventory.item_added']);
});

test('business errors come back as the service result, not as exceptions', async () => {
  const outcome = await commands.dispatch({ name: RecipeHandlers.delete, userId: 'someone', params: { recipeId: 'does-not-exist' } });

  assert.deepEqual(outcome, {
    status: 'handled',
    result: { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' }
  });
});

test('every module exposes its handlers', () => {
  const names = commands['inner'].names();
  for (const prefix of ['auth.', 'plans.', 'inventory.', 'recipes.', 'community.', 'feedback.', 'recommendations.', 'shopping.', 'chef.', 'food.']) {
    assert.ok(names.some((name) => name.startsWith(prefix)), `faltan handlers ${prefix}`);
  }
});
