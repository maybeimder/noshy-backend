import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CookingController } from './cooking.controller.js';
import { AbandonBody, CompleteBody, EventsBody, SessionParams, StartBody } from './cooking.dto.js';

export async function cookingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new CookingController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Modo cocina'];

  r.post('/me/cooking-sessions', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Empezar a cocinar', body: StartBody } }, (req, rep) => c.start(req, rep));
  r.get('/me/cooking-sessions/active', { preHandler: done, schema: { tags, summary: 'Sesión sin terminar' } }, (req, rep) => c.active(req, rep));
  r.get('/me/cooking-sessions/:sessionId', { preHandler: done, schema: { tags, summary: 'Sesión completa (para retomar)', params: SessionParams } }, (req) => c.get(req));
  r.post('/me/cooking-sessions/:sessionId/events', { preHandler: done, schema: { tags, summary: 'Eventos de la sesión (en lote)', params: SessionParams, body: EventsBody } }, (req, rep) => c.events(req, rep));
  r.post('/me/cooking-sessions/:sessionId/complete', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Terminar y registrar', params: SessionParams, body: CompleteBody } }, (req) => c.complete(req));
  r.post('/me/cooking-sessions/:sessionId/abandon', { preHandler: done, schema: { tags, summary: 'Salir sin terminar', params: SessionParams, body: AbandonBody } }, (req, rep) => c.abandon(req, rep));
}
