// La API completa (HTTP -> CommandBus -> servicios) sobre Postgres real. Se salta si no hay DATABASE_URL.
//   $env:DATABASE_URL='postgres://noshy:noshy@localhost:5433/noshy'; pnpm exec tsx --test src/infrastructure/database/postgres-api.live.test.ts
// Cada corrida usa un schema temporal propio y lo borra al final.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { Pool } from 'pg';
import { CommandBus } from '../../core/commands/command-bus';
import { createCommandBus } from '../event-bus/command-bus';
import { createOutboxRelay, eventFactory } from '../event-bus/register-observers';
import { createServer } from '../http/server';
import { configurePersistence, db, type Persistence } from '../persistence/persistence';
import { replayEvents } from '../../core/events/replay';
import { RecommendationEngine } from '../../modules/recommendations/events/recommendations.observers';
import { SubjectRegistry } from '../../core/events/subject';
import { addInventoryItem } from '../../modules/inventory/inventory.service';
import { createPool } from './db.connection';
import { runMigrations } from './migrations';
import { PostgresEventStore } from './postgres-event-store';
import { createPostgresPersistence, PostgresProcessedMessageStore } from './postgres-persistence';

const url = process.env.DATABASE_URL;
const skip = url ? false : 'DATABASE_URL no definido';
const schema = `test_${randomUUID().replaceAll('-', '')}`;
let admin: Pool;
let pool: Pool;
let eventStore: PostgresEventStore;
let persistence: Persistence;
let bus: CommandBus;

before(async () => {
  if (!url) return;
  admin = createPool(url, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool(url, { schema });
  await runMigrations(pool);
  eventStore = new PostgresEventStore(pool);
  persistence = createPostgresPersistence(pool, eventStore);
  configurePersistence(persistence);
  bus = createCommandBus({ processedMessages: new PostgresProcessedMessageStore(pool) });
});

after(async () => {
  if (!url) return;
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].count);

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createServer({ commandBus: bus }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const call = async (baseUrl: string, method: string, path: string, body?: unknown, token?: string) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

test('full MVP flow over HTTP persists state and events in Postgres', { skip }, async () => {
  await withServer(async (baseUrl) => {
    const registered = await call(baseUrl, 'POST', '/auth/register', { name: 'Ana', email: 'ana@noshy.com', password: 'StrongPass1!' });
    assert.equal(registered.status, 201);
    const { token, user } = registered.body;

    assert.equal((await call(baseUrl, 'POST', '/auth/login', { email: 'ana@noshy.com', password: 'StrongPass1!' })).status, 200);
    assert.equal((await call(baseUrl, 'POST', '/auth/login', { email: 'ana@noshy.com', password: 'OtraClave9!' })).status, 401);
    assert.equal((await call(baseUrl, 'GET', '/auth/me', undefined, token)).body.email, 'ana@noshy.com');

    assert.equal((await call(baseUrl, 'POST', '/plans', { objective: 'maintain', targets: { calories: 2000 } }, token)).status, 201);
    assert.equal((await call(baseUrl, 'GET', '/plans/active', undefined, token)).body.objective, 'maintain');

    const item = await call(baseUrl, 'POST', '/inventory/items', { name: 'Arroz', quantity: 2, unit: 'kg' }, token);
    assert.equal(item.status, 201);
    assert.equal((await call(baseUrl, 'PATCH', `/inventory/items/${item.body.id}`, { quantity: 3 }, token)).body.quantity, 3);

    const recipe = await call(baseUrl, 'POST', '/recipes', {
      title: 'Arroz con pollo',
      ingredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }],
      instructions: ['Cocinar']
    }, token);
    assert.equal(recipe.status, 201);
    assert.equal((await call(baseUrl, 'POST', `/recipes/${recipe.body.id}/publish`, undefined, token)).body.authorName, 'Ana');
    assert.equal((await call(baseUrl, 'GET', `/community/recipes/${recipe.body.id}`)).body.title, 'Arroz con pollo');
    assert.equal((await call(baseUrl, 'GET', '/community/recipes/no-existe')).status, 404);

    const session = await call(baseUrl, 'POST', '/chef/sessions', undefined, token);
    assert.equal(session.status, 201);
    const feedback = await call(baseUrl, 'POST', '/feedback', {
      sessionId: session.body.id,
      targetType: 'recipe',
      targetId: recipe.body.id,
      targetName: 'Arroz con pollo',
      eventType: 'prepared'
    }, token);
    assert.equal(feedback.status, 201);
    const closed = await call(baseUrl, 'POST', `/chef/sessions/${session.body.id}/close`, { reason: 'manual', preferencesMarkdown: '# Preferencias\nSin gluten\n' }, token);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.preferencesVersion, 2);

    // Estado en tablas reales
    assert.equal(await count('SELECT count(*) FROM users'), 1);
    assert.equal(await count('SELECT count(*) FROM inventory_items WHERE user_id = $1', [user.id]), 1);
    assert.equal(await count('SELECT count(*) FROM recipes WHERE is_public'), 1);
    assert.equal(await count('SELECT count(*) FROM feedback_entries'), 1);
    assert.equal(await count(`SELECT count(*) FROM chef_sessions WHERE status = 'closed'`), 1);
    assert.equal((await pool.query('SELECT version FROM preferences_documents')).rows[0].version, 2);
    // La contraseña nunca se guarda en claro
    assert.match((await pool.query('SELECT password_hash FROM users')).rows[0].password_hash, /^scrypt\$/);

    // Cada mutación dejó su evento + fila de outbox
    const types = (await eventStore.readStream(user.id)).map((record) => record.type);
    assert.deepEqual(types, [
      'auth.user_registered',
      'auth.user_logged_in',
      'plans.nutrition_plan_created',
      'inventory.item_added',
      'inventory.item_updated',
      'recipes.recipe_created',
      'recipes.recipe_published',
      'chef.session_opened',
      'feedback.feedback_recorded',
      'chef.session_closed'
    ]);
    assert.equal(await count('SELECT count(*) FROM outbox'), types.length);
  });
});

test('transactional outbox: if writing the event fails, the state change is rolled back too', { skip }, async () => {
  const userId = (await pool.query('SELECT id FROM users LIMIT 1')).rows[0].id;
  const before = await count('SELECT count(*) FROM inventory_items');

  configurePersistence({
    ...persistence,
    events: {
      ...persistence.events,
      append: async (events, tx) => {
        await persistence.events.append(events, tx); // se escribe...
        throw new Error('el event store se cayó'); // ...y falla después, dentro de la misma transacción
      }
    }
  });
  try {
    await assert.rejects(addInventoryItem(userId, { name: 'Frijol', quantity: 1, unit: 'kg' }), /se cayó/);
  } finally {
    configurePersistence(persistence);
  }

  assert.equal(await count('SELECT count(*) FROM inventory_items'), before, 'el ítem no debe quedar guardado');
  assert.equal(await count(`SELECT count(*) FROM event_store WHERE payload->'item'->>'name' = 'Frijol'`), 0);
});

test('the outbox relay delivers persisted events and projections can be rebuilt from Postgres', { skip }, async () => {
  const live = new RecommendationEngine();
  const relay = createOutboxRelay(eventStore, new SubjectRegistry([live]));
  await relay.drainAll();
  assert.equal(await count(`SELECT count(*) FROM outbox WHERE status <> 'dispatched'`), 0);

  const userId = (await pool.query('SELECT id FROM users LIMIT 1')).rows[0].id;
  assert.equal(live.topFor(userId)[0].targetName, 'Arroz con pollo');

  const rebuilt = new RecommendationEngine();
  await replayEvents(eventStore, eventFactory, [rebuilt]);
  assert.deepEqual(rebuilt.topFor(userId), live.topFor(userId));
});

test('command bus idempotency survives in Postgres: a redelivered messageId runs once', { skip }, async () => {
  const userId = (await pool.query('SELECT id FROM users LIMIT 1')).rows[0].id;
  const before = await count('SELECT count(*) FROM inventory_items');
  const message = { name: 'inventory.add', userId, data: { name: 'Lenteja', quantity: 1, unit: 'kg' }, messageId: randomUUID() };

  assert.equal((await bus.dispatch(message)).status, 'handled');
  // Un bus NUEVO (como tras un reinicio) también lo reconoce: el registro está en processed_messages.
  const restarted = createCommandBus({ processedMessages: new PostgresProcessedMessageStore(pool) });
  assert.equal((await restarted.dispatch(message)).status, 'duplicate');
  assert.equal(await count('SELECT count(*) FROM inventory_items'), before + 1);
  assert.ok(db() === persistence);
});
