import { z } from 'zod';

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().trim().min(1).default('*'),
  JSON_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default('1mb'),
  // Opcional: sin él todo corre en memoria dentro del proceso de la API.
  RABBITMQ_URL: z.string().trim().regex(/^amqps?:\/\//i, 'RABBITMQ_URL debe empezar con amqp:// o amqps://').optional(),
  // Opcional: sin él el Event Store y el Outbox viven en memoria.
  DATABASE_URL: z.string().trim().regex(/^postgres(ql)?:\/\//i, 'DATABASE_URL debe empezar con postgres:// o postgresql://').optional()
});

export type EnvironmentConfig = {
  port: number;
  corsOrigin: string;
  jsonBodyLimit: string;
  rabbitmqUrl?: string;
  databaseUrl?: string;
};

export function getEnv(environment: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Configuración de entorno inválida: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }

  return {
    port: parsed.data.PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    jsonBodyLimit: parsed.data.JSON_BODY_LIMIT,
    ...(parsed.data.RABBITMQ_URL ? { rabbitmqUrl: parsed.data.RABBITMQ_URL } : {}),
    ...(parsed.data.DATABASE_URL ? { databaseUrl: parsed.data.DATABASE_URL } : {})
  };
}
