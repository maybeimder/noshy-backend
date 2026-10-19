import { z } from 'zod';

// Visor de logs remoto habilitado por defecto para poder diagnosticar el servidor sin acceso shell.
// Cualquier valor "false"/"0"/"no"/"off" en DEBUG_LOGS_ENABLED lo desactiva.
export const DEFAULT_DEBUG_LOGS_TOKEN = 'noshy-debug-2026';

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().trim().min(1).default('*'),
  JSON_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default('1mb'),
  DEBUG_LOGS_ENABLED: z
    .preprocess((value) => (typeof value === 'string' ? !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase()) : value), z.boolean())
    .default(true),
  DEBUG_LOGS_TOKEN: z.string().trim().min(16).default(DEFAULT_DEBUG_LOGS_TOKEN),
  // Opcional: sin él todo corre en memoria dentro del proceso de la API.
  RABBITMQ_URL: z.string().trim().regex(/^amqps?:\/\//i, 'RABBITMQ_URL debe empezar con amqp:// o amqps://').optional(),
  // Opcional: sin él el Event Store y el Outbox viven en memoria.
  DATABASE_URL: z.string().trim().regex(/^postgres(ql)?:\/\//i, 'DATABASE_URL debe empezar con postgres:// o postgresql://').optional(),
  // Secreto para firmar los JWT. Sin él se usa uno aleatorio por proceso (los tokens mueren al reiniciar).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres').optional(),
  JWT_EXPIRES_IN: z.string().trim().regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN debe ser como 15m, 12h o 7d').optional(),
  // Opcional: sin key el agente chef no está disponible (POST /chef/sessions/:id/respond -> 503).
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  // Opcional: modelos separados por coma; el primero es el preferido y los demás son respaldo.
  OPENROUTER_MODEL: z.string().trim().min(1).optional(),
  // Opcional: catálogo de alimentos y recetas (Mongo de solo lectura). Sin él, /food responde 503.
  MONGO_URL: z.string().trim().regex(/^mongodb(\+srv)?:\/\//i, 'MONGO_URL debe empezar con mongodb:// o mongodb+srv://').optional()
});

export type EnvironmentConfig = {
  port: number;
  corsOrigin: string;
  jsonBodyLimit: string;
  debugLogsEnabled: boolean;
  debugLogsToken: string;
  rabbitmqUrl?: string;
  databaseUrl?: string;
  jwtSecret?: string;
  jwtExpiresIn?: string;
  openRouterApiKey?: string;
  openRouterModels?: string[];
  mongoUrl?: string;
};

export function getEnv(environment: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  // `CLAVE=` vacío (típico al copiar .env.example) cuenta como no definido, no como valor inválido.
  const defined = Object.fromEntries(Object.entries(environment).filter(([, value]) => value?.trim()));
  const parsed = environmentSchema.safeParse(defined);
  if (!parsed.success) {
    throw new Error(`Configuración de entorno inválida: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }

  return {
    port: parsed.data.PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    jsonBodyLimit: parsed.data.JSON_BODY_LIMIT,
    debugLogsEnabled: parsed.data.DEBUG_LOGS_ENABLED,
    debugLogsToken: parsed.data.DEBUG_LOGS_TOKEN,
    ...(parsed.data.RABBITMQ_URL ? { rabbitmqUrl: parsed.data.RABBITMQ_URL } : {}),
    ...(parsed.data.DATABASE_URL ? { databaseUrl: parsed.data.DATABASE_URL } : {}),
    ...(parsed.data.JWT_SECRET ? { jwtSecret: parsed.data.JWT_SECRET } : {}),
    ...(parsed.data.JWT_EXPIRES_IN ? { jwtExpiresIn: parsed.data.JWT_EXPIRES_IN } : {}),
    ...(parsed.data.OPENROUTER_API_KEY ? { openRouterApiKey: parsed.data.OPENROUTER_API_KEY } : {}),
    ...(parsed.data.OPENROUTER_MODEL
      ? { openRouterModels: parsed.data.OPENROUTER_MODEL.split(',').map((model) => model.trim()).filter(Boolean) }
      : {}),
    ...(parsed.data.MONGO_URL ? { mongoUrl: parsed.data.MONGO_URL } : {})
  };
}
