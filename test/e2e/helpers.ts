import pg from 'pg';
import { MongoClient } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/infrastructure/config/env.js';
import { buildApp } from '../../src/infrastructure/http/server.js';
import { runMigrations } from '../../src/infrastructure/database/postgres/migrate.js';
import { createPostgres } from '../../src/infrastructure/database/postgres/postgres.client.js';
import type { FoodDoc } from '../../src/infrastructure/database/mongo/collections.js';
import { normalizeText } from '../../src/modules/catalog/food-text.js';
import { seed } from '../../src/infrastructure/database/seed/seed.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/noshy_test';
export const TEST_MONGO_URL = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
/** Base de prueba en Mongo. Se vacía en cada corrida, por eso debe llevar «test» en el nombre (nunca `food`). */
const TEST_MONGO_DB = process.env.TEST_MONGO_DB ?? 'noshy_test';
if (!/test/i.test(TEST_MONGO_DB)) throw new Error(`TEST_MONGO_DB="${TEST_MONGO_DB}" no parece de prueba: los tests la vacían`);
/** `TEST_EVENT_TRANSPORT=rabbitmq` corre toda la suite contra un RabbitMQ real (`pnpm test:rabbit`). */
export const TEST_EVENT_TRANSPORT = process.env.TEST_EVENT_TRANSPORT === 'rabbitmq' ? 'rabbitmq' : 'in-process';
export const TEST_RABBITMQ_URL = process.env.TEST_RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
export const TEST_RABBITMQ_PREFIX = 'noshy_test';

/** Muestra de `products_slim` con la forma del catálogo real. */
const food = (_id: string, name: string, o: Partial<FoodDoc> = {}): FoodDoc => ({ _id, name, brand: 'generic', popularity: 1, completeness: 0.5, search: normalizeText(`${name} ${o.brand ?? ''}`), ...o });
const FOODS: FoodDoc[] = [
  food('usda:1', 'Quinua (cruda)', { popularity: 1000, servings: [{ label: '100 g', grams: 100 }, { label: '1 taza', grams: 170 }], foodGroups: ['cereals'], per100g: { kcal: 368, protein_g: 14, carbs_g: 64, fat_g: 6 } }),
  food('7701', 'Quinua en grano', { brand: 'Nutrilón', quantity: '500 g', nova: 1 }),
  food('7702', 'Galletas con quinua', { brand: 'Tosh', popularity: 5000, allergens: ['en:milk', 'en:gluten'], foodGroups: ['biscuits-and-cakes'] }),
  food('7703', 'Quinua sospechosa', { suspect: true, popularity: 9999 }),
  food('7704', 'Crema de leche', { popularity: 900 }),
  food('7705', 'Crema de leche', { brand: 'Alpina', quantity: '200 ml', allergens: ['en:milk'], popularity: 800 }),
  ...Array.from({ length: 12 }, (_, n) => food(`arroz${n}`, 'Arroz blanco', { brand: `Marca ${n}`, quantity: '500 g', popularity: n })),
];

/** Base limpia: esquema de Postgres recreado, migraciones, catálogo y Mongo vacío. */
export async function resetDatabases() {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  await runMigrations(TEST_DB_URL);
  const p = createPostgres(TEST_DB_URL);
  await seed(p.db);
  await p.close();
  // Solo las colecciones del backend (basta con permisos readWrite sobre la base de prueba).
  const m = await MongoClient.connect(TEST_MONGO_URL);
  const db = m.db(TEST_MONGO_DB);
  const mine = new Set(['chef_threads', 'chef_messages', 'cooking_events', 'user_signals', 'insights', 'receipt_scans', 'products_slim']);
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (mine.has(name)) await db.collection(name).drop();
  }
  await db.collection<FoodDoc>('products_slim').insertMany(FOODS);
  await m.close();
  if (TEST_EVENT_TRANSPORT === 'rabbitmq') await purgeTestQueues();
}

/** Vacía las colas de prueba (`noshy_test.*`) para que una suite no herede mensajes de otra. */
export async function purgeTestQueues(prefix = TEST_RABBITMQ_PREFIX) {
  const { connect } = await import('amqplib');
  const conn = await connect(TEST_RABBITMQ_URL);
  const ch = await conn.createChannel();
  ch.on('error', () => undefined);
  for (const q of [`${prefix}.events.observers`, `${prefix}.dead-letters`]) {
    await ch.purgeQueue(q).catch(() => undefined);
  }
  await conn.close().catch(() => undefined);
}

export async function testApp(): Promise<FastifyInstance> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    MONGO_URL: TEST_MONGO_URL,
    MONGO_DB: TEST_MONGO_DB,
    MONGO_FOOD_DB: TEST_MONGO_DB,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    RUN_WORKERS: 'false',
    RATE_LIMIT_ENABLED: 'false',
    STORAGE_DIR: './.storage-test',
    RECEIPT_PARSER: 'mock',
    EVENT_TRANSPORT: TEST_EVENT_TRANSPORT,
    ...(TEST_EVENT_TRANSPORT === 'rabbitmq' ? { RABBITMQ_URL: TEST_RABBITMQ_URL, RABBITMQ_PREFIX: TEST_RABBITMQ_PREFIX, RABBITMQ_RETRY_DELAYS_MS: '200,400' } : {}),
  });
  const app = await buildApp({ env, logger: false });
  await app.ready();
  // Con RabbitMQ el consumer corre en el mismo proceso; el relay no: lo mueve `drain` a mano.
  await app.container.events.start({ relay: false, consumer: true }, env.OUTBOX_POLL_MS);
  return app;
}

export type Res<T = any> = { status: number; body: T; headers: Record<string, unknown>; raw: string };

export function client(app: FastifyInstance) {
  let token: string | null = null;
  const call = async <T = any>(method: string, url: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Promise<Res<T>> => {
    const res = await app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: { 'x-timezone': 'America/Bogota', ...(token && opts.auth !== false ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    let body: any = null;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      body = null;
    }
    return { status: res.statusCode, body, headers: res.headers, raw: res.body };
  };
  return {
    call,
    get: <T = any>(url: string, o?: Parameters<typeof call>[2]) => call<T>('GET', url, o),
    post: <T = any>(url: string, body?: unknown, o?: Parameters<typeof call>[2]) => call<T>('POST', url, { ...o, body: body ?? {} }),
    patch: <T = any>(url: string, body: unknown, o?: Parameters<typeof call>[2]) => call<T>('PATCH', url, { ...o, body }),
    put: <T = any>(url: string, o?: Parameters<typeof call>[2]) => call<T>('PUT', url, o),
    del: <T = any>(url: string, o?: Parameters<typeof call>[2]) => call<T>('DELETE', url, o),
    setToken: (t: string | null) => (token = t),
    getToken: () => token,
  };
}

/** Entrega todos los eventos pendientes y espera a los observers (en producción lo hacen el relay y el worker). */
export const drain = (app: FastifyInstance) => app.container.events.drain();

export const ONBOARDING_PAYLOAD = {
  goals: { ids: ['eatHealthier', 'saveTime'], customNote: null },
  activityLevel: 'active',
  nutrition: { kcalTarget: 2200, adjustedByUser: false },
  restrictions: { dietStyle: 'omnivore', allergyIds: ['lactose', 'shellfish'], careIds: ['lessSugar'], customExclusions: ['cilantro'] },
  tastes: { favoriteDishIds: ['bibimbap', 'arepa', 'tacos', 'pancakes', 'pasta'] },
  kitchen: { mealsPerDay: 3, maxCookingMinutes: 30, skillLevel: 'intermediate', equipmentIds: ['airfryer', 'oven', 'microwave'] },
  shopping: { storeIds: ['exito', 'd1', 'plaza'], priceQualityBalance: 0.7, weeklyBudget: { amount: 180000, currency: 'COP' } },
  skippedSteps: [],
};
