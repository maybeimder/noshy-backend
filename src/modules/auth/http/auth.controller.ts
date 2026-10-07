import type { Request, Response } from 'express';
import { runHandler } from '../../../infrastructure/http/command-dispatch';
import type { loginUser, registerUser } from '../auth.service';
import { AuthHandlers } from '../events/auth.handlers';
import { authHeaderSchema } from './auth.dto';

export class AuthController {
  static register = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof registerUser>>(request, response, AuthHandlers.register, { data: request.body });
    if (!outcome) return;
    const { result } = outcome;

    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };

  static login = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof loginUser>>(request, response, AuthHandlers.login, { data: request.body });
    if (!outcome) return;
    const { result } = outcome;

    if (!result.ok) {
      response.status(401).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static me = async (request: Request, response: Response) => {
    const authHeader = request.headers.authorization ?? '';
    const parsed = authHeaderSchema.safeParse({ authorization: authHeader });

    if (!parsed.success) {
      response.status(401).json({ message: 'Token de autorización requerido.' });
      return;
    }

    const token = parsed.data.authorization.replace(/^Bearer\s+/i, '');
    const outcome = await runHandler<{ id: string; name: string; email: string } | null>(request, response, AuthHandlers.me, {
      params: { token }
    });
    if (!outcome) return;

    if (!outcome.result) {
      response.status(401).json({ message: 'Token inválido o expirado.' });
      return;
    }

    response.status(200).json(outcome.result);
  };
}