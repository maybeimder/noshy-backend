import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ProfileController } from './profile.controller.js';
import { PreferencesPatchBody } from '../../onboarding/http/onboarding.dto.js';

export async function profileRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new ProfileController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Perfil y preferencias'];

  r.get('/me/profile', { preHandler: done, schema: { tags, summary: 'Perfil completo' } }, (req) => c.get(req));
  r.patch('/me/preferences', { preHandler: done, schema: { tags, summary: 'Editar una sección de preferencias', body: PreferencesPatchBody } }, (req) => c.patchPreferences(req));
}
