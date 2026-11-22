import type { FastifyInstance, FastifyRequest } from 'fastify';
import { errors as joseErrors } from 'jose';
import { Errors } from '../../../core/shared/errors.js';

/** Lee el Bearer JWT y deja `request.user`. El userId sale siempre del token (claim `sub`). */
export function registerAuthenticate(app: FastifyInstance) {
  app.decorateRequest('user', null as unknown as { id: string });
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();
    try {
      const { sub } = await app.container.services.tokens.verifyAccess(header.slice(7));
      request.user = { id: sub };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw Errors.unauthorized('TOKEN_EXPIRED', 'Tu sesión expiró.');
      throw Errors.unauthorized();
    }
  });
}
