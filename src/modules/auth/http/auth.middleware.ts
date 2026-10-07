import type { NextFunction, Request, Response } from 'express';
import { getUserByToken } from '../auth.service';

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.headers.authorization ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const user = token ? await getUserByToken(token) : null;

  if (!user) {
    response.status(401).json({ message: 'Token inválido o expirado.' });
    return;
  }

  // Solo datos públicos: el hash de la contraseña nunca viaja en la request.
  (request as Request & { user?: { id: string; name: string; email: string } }).user = { id: user.id, name: user.name, email: user.email };
  next();
}
