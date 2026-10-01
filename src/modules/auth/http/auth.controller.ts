import type { Request, Response } from 'express';
import { authHeaderSchema, loginSchema, registerSchema } from './auth.dto';
import { getUserByToken, loginUser, registerUser } from '../auth.service';

export class AuthController {
  static register = (request: Request, response: Response) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        message: 'Datos inválidos.',
        issues: parsed.error.issues
      });
      return;
    }

    const result = registerUser(parsed.data);

    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };

  static login = (request: Request, response: Response) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        message: 'Datos inválidos.',
        issues: parsed.error.issues
      });
      return;
    }

    const result = loginUser(parsed.data);

    if (!result.ok) {
      response.status(401).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static me = (request: Request, response: Response) => {
    const authHeader = request.headers.authorization ?? '';
    const parsed = authHeaderSchema.safeParse({ authorization: authHeader });

    if (!parsed.success) {
      response.status(401).json({ message: 'Token de autorización requerido.' });
      return;
    }

    const token = parsed.data.authorization.replace(/^Bearer\s+/i, '');
    const user = getUserByToken(token);

    if (!user) {
      response.status(401).json({ message: 'Token inválido o expirado.' });
      return;
    }

    response.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email
    });
  };
}
