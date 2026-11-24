import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Env } from '../config/env.js';
import { createContainer, type Providers } from '../../container.js';
import { createObservers } from '../event-bus/register-observers.js';
import { registerErrorHandler } from './middlewares/error.middleware.js';
import { registerAuthenticate } from '../../modules/auth/index.js';
import { registerRequireOnboarding } from '../../modules/onboarding/index.js';
import { registerTimezone } from './middlewares/timezone.middleware.js';
import { registerIdempotency } from './middlewares/idempotency.middleware.js';
import { LlmChefEngine } from '../../modules/chef/index.js';
import { apiV1 } from './routes.js';

export type BuildOptions = { env: Env; logger?: FastifyServerOptions['logger']; providers?: Partial<Providers> };

/** Arma la app HTTP: plugins, middlewares, contenedor de dependencias, observers y rutas. */
export async function buildApp({ env, logger, providers }: BuildOptions) {
  const app = Fastify({
    logger:
      logger ??
      (env.NODE_ENV === 'development'
        ? { level: env.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : { level: env.LOG_LEVEL }),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = await createContainer(env, app.log, providers);
  app.decorate('container', container);
  container.events.attach(createObservers(container));
  app.addHook('onClose', async () => container.close());

  await app.register(helmet, { contentSecurityPolicy: false });
  // `methods` explícito: por defecto @fastify/cors solo permite GET, HEAD y POST.
  await app.register(cors, { origin: true, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], exposedHeaders: ['ETag', 'Idempotent-Replayed'] });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  if (env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', keyGenerator: (req) => req.headers.authorization ?? req.ip });
  }
  app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  await app.register(swagger, {
    openapi: {
      info: { title: 'Noshy API', version: '1.0.0', description: 'Contrato v0.3. Autenticación Bearer JWT; respuestas `{ data, meta? }`; errores `{ error: { code, message, details? } }`.' },
      servers: [{ url: env.PUBLIC_BASE_URL }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerErrorHandler(app);
  registerTimezone(app);
  registerAuthenticate(app);
  registerRequireOnboarding(app);
  registerIdempotency(app);

  app.get('/health', { schema: { hide: true } }, async (_req, reply) => {
    const [pg, mongo] = await Promise.allSettled([container.pg.pool.query('select 1'), container.mongo.client.db().command({ ping: 1 })]);
    const ok = pg.status === 'fulfilled' && mongo.status === 'fulfilled';
    // Sin broker la API sigue sirviendo: los eventos esperan en el outbox. Por eso no tumba el healthcheck.
    const broker = container.events.transport;
    const status = !ok ? 'down' : broker.healthy() ? 'ok' : 'degraded';
    return reply
      .code(ok ? 200 : 503)
      .send({ status, postgres: pg.status === 'fulfilled', mongo: mongo.status === 'fulfilled', events: { transport: broker.kind, connected: broker.healthy() }, chef: container.providers.chefEngine instanceof LlmChefEngine ? 'openrouter' : 'rules' });
  });

  await app.register(apiV1, { prefix: '/api/v1' });
  return app;
}
