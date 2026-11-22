import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Errors } from '../../../core/shared/errors.js';

/** Rutas de la experiencia diaria: exigen onboarding completo → 409 ONBOARDING_INCOMPLETE. */
export function registerRequireOnboarding(app: FastifyInstance) {
  app.decorate('requireOnboarding', async (request: FastifyRequest) => {
    const status = await app.container.repos.users.onboardingStatus(request.user.id);
    if (status === null) throw Errors.unauthorized();
    if (status !== 'completed') throw Errors.onboardingIncomplete();
  });
}
