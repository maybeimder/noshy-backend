import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  /** Base de los enlaces que se comparten (recetas, listas). */
  SHARE_BASE_URL: z.string().url().default('https://noshy.app'),

  DATABASE_URL: z.string().min(1),
  MONGO_URL: z.string().min(1),
  /** Opcional: por defecto, la base que viene en MONGO_URL (`…/food` → `food`). */
  MONGO_DB: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

  /** Base del catálogo de alimentos (`products_slim`), de solo lectura. */
  MONGO_FOOD_DB: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('food')),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  GOOGLE_CLIENT_IDS: csv,
  APPLE_CLIENT_IDS: csv,

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_DIR: z.string().default('./.storage'),
  UPLOAD_SIGNING_SECRET: z.string().min(8).default('dev-upload-secret'),

  RECEIPT_PARSER: z.enum(['mock', 'none']).default('mock'),
  /** rules: motor determinista · openrouter: LLM con respaldo en reglas (necesita OPENROUTER_API_KEY). */
  CHEF_ENGINE: z.enum(['rules', 'openrouter']).optional(),
  OPENROUTER_API_KEY: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().optional()),
  OPENROUTER_MODEL: csv,
  /** Cuántas recetas de `recipes_raw` traer con macros estimados (0 = ninguna). Necesita OPENROUTER_API_KEY. */
  LIBRARY_RECIPES_TARGET: z.coerce.number().int().min(0).max(2_000).default(200),

  /** Aplica migraciones y carga el catálogo (si está vacío) al arrancar la API. */
  MIGRATE_ON_START: bool.default(true),
  SEED_ON_START: bool.default(true),

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
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return parsed.data;
}
