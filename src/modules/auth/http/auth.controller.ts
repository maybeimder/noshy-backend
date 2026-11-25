import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { ChangePasswordBody, LoginBody, OAuthBody, OAuthParams, RefreshBody, RegisterBody } from './auth.dto.js';

export class AuthController {
  constructor(private readonly c: Container) {}

  register = async (req: Req<{ Body: z.infer<typeof RegisterBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.commands.execute('auth.register', { input: req.body, tz: req.tz }));
  };

  login = async (req: Req<{ Body: z.infer<typeof LoginBody> }>) => ok(await this.c.commands.execute('auth.login', { input: req.body, tz: req.tz }));

  oauth = async (req: Req<{ Params: z.infer<typeof OAuthParams>; Body: z.infer<typeof OAuthBody> }>, reply: Rep) => {
    const result = await this.c.commands.execute('auth.oauthSignIn', { provider: req.params.provider, input: req.body, tz: req.tz });
    reply.code(result.isNewUser ? 201 : 200);
    return ok(result);
  };

  logout = async (req: Req<{ Body: z.infer<typeof RefreshBody> }>, reply: Rep) => {
    await this.c.commands.execute('auth.logout', { refreshToken: req.body.refreshToken });
    return reply.code(204).send();
  };

  changePassword = async (req: Req<{ Body: z.infer<typeof ChangePasswordBody> }>) => ok(await this.c.commands.execute('auth.changePassword', { userId: req.user.id, input: req.body }));

  refresh = async (req: Req<{ Body: z.infer<typeof RefreshBody> }>) => ok(await this.c.commands.execute('auth.refresh', { refreshToken: req.body.refreshToken }));
}
