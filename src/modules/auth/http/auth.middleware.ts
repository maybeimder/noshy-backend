import type { NextFunction, Request, Response } from 'express';
import { applicationLogger } from '../../../infrastructure/observability/logger';
import { getUserByToken } from '../auth.service';

type RequestWithId = Request & { requestId?: string };

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.headers.authorization ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const requestId = (request as RequestWithId).requestId;

  if (!token) {
    applicationLogger.warn('auth.token.missing', `Sin token en ${request.method} ${request.originalUrl}`, {
      requestId,
      path: request.path,
      authHeaderPresent: Boolean(authorization)
    });
    response.status(401).json({ message: 'Token inválido o expirado.' });
    return;
  }

  const user = await getUserByToken(token);
  if (!user) {
    applicationLogger.warn('auth.token.invalid', `Token inválido o expirado en ${request.method} ${request.originalUrl}`, {
      requestId,
      path: request.path
    });
    response.status(401).json({ message: 'Token inválido o expirado.' });
    return;
  }

  applicationLogger.debug('auth.token.valid', `Usuario ${user.id} autenticado en ${request.method} ${request.originalUrl}`, {
    requestId,
    userId: user.id,
    path: request.path
  });

  // Solo datos públicos: el hash de la contraseña nunca viaja en la request.
  (request as Request & { user?: { id: string; name: string; email: string } }).user = { id: user.id, name: user.name, email: user.email };
  next();
}
