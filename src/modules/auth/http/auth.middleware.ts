import type { NextFunction, Request, Response } from 'express';
import { getUserByToken } from '../auth.service';

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const authorization = request.headers.authorization ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();

  if (!token || !getUserByToken(token)) {
    response.status(401).json({ message: 'Token inválido o expirado.' });
    return;
  }

  (request as Request & { user?: { id: string; name: string; email: string } }).user = getUserByToken(token)!;
  next();
}
