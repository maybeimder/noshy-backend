import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingController } from './onboarding.controller.js';
import { CompleteBody, DraftBody, NutritionPreviewBody } from './onboarding.dto.js';

export async function onboardingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new OnboardingController(app.container);
  const auth = [app.authenticate];
  const tags = ['Onboarding'];

  r.get('/onboarding/options', { preHandler: auth, schema: { tags, summary: 'Catálogos de todas las opciones' } }, async (req, reply) => {
    const body = await c.options();
    const etag = `"${body.data.version}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=3600');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return body;
  });
  r.post('/nutrition/targets/preview', { preHandler: auth, schema: { tags, summary: 'Calcular punto de partida', body: NutritionPreviewBody } }, (req) => c.preview(req));
  r.get('/me/onboarding', { preHandler: auth, schema: { tags, summary: 'Estado y borrador del onboarding' } }, (req) => c.state(req));
  r.patch('/me/onboarding', { preHandler: auth, schema: { tags, summary: 'Guardar borrador', body: DraftBody } }, (req) => c.saveDraft(req));
  r.post('/me/onboarding/complete', { preHandler: [...auth, app.idempotent], schema: { tags, summary: 'Enviar el paquete y crear el chef', body: CompleteBody } }, (req) => c.complete(req));
}
