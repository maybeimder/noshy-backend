import 'fastify';
import type {} from '@fastify/rate-limit';
import type {} from '@fastify/multipart';
import type { Container } from '../container.js';
import type { preHandlerAsyncHookHandler } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
    authenticate: preHandlerAsyncHookHandler;
    requireOnboarding: preHandlerAsyncHookHandler;
    idempotent: preHandlerAsyncHookHandler;
  }
  interface FastifyRequest {
    /** Usuario autenticado. Solo existe en rutas con `authenticate`. */
    user: { id: string };
    /** Zona horaria del usuario (header `X-Timezone`). */
    tz: string;
    idempotencyClaim?: { key: string; route: string };
  }
}
