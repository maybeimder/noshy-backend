import { z } from 'zod';

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CORS_ORIGIN: z.string().trim().min(1).default('*'),
  JSON_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default('1mb')
});

export type EnvironmentConfig = {
  port: number;
  corsOrigin: string;
  jsonBodyLimit: string;
};

export function getEnv(environment: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Configuración de entorno inválida: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`);
  }

  return {
    port: parsed.data.PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    jsonBodyLimit: parsed.data.JSON_BODY_LIMIT
  };
}
