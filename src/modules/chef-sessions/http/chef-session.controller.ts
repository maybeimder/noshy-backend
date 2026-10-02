import type { Request, Response } from 'express';
import { closeChefSession, openChefSession } from '../chef-session.service';
import { closeChefSessionSchema } from './chef-session.dto';

type AuthenticatedRequest = Request & { user?: { id: string; name: string; email: string } };

export class ChefSessionController {
  static open = (request: AuthenticatedRequest, response: Response) => {
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(201).json(openChefSession(request.user.id));
  };

  static close = (request: AuthenticatedRequest, response: Response) => {
    const parsed = closeChefSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = closeChefSession(request.user.id, sessionId, parsed.data);
    if (!result.ok) {
      const status = result.code === 'PREFERENCES_VERSION_CONFLICT' ? 409 : 404;
      response.status(status).json({
        code: result.code,
        message: result.message,
        ...('data' in result ? { session: result.data } : {})
      });
      return;
    }

    response.status(200).json(result.data);
  };
}
