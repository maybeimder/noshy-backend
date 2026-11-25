import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { ChangePasswordBody, LoginBody, OAuthBody, OAuthParams, RefreshBody, RegisterBody } from './auth.dto.js';

export class AuthController {
  constructor(private readonly c: Container) {}

  register = async (req: Req<{ Body: z.infer<typeof RegisterBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.auth.register(req.body, req.tz));
  };

  login = async (req: Req<{ Body: z.infer<typeof LoginBody> }>) => ok(await this.c.services.auth.login(req.body, req.tz));

  oauth = async (req: Req<{ Params: z.infer<typeof OAuthParams>; Body: z.infer<typeof OAuthBody> }>, reply: Rep) => {
    const result = await this.c.services.auth.oauthSignIn(req.params.provider, req.body, req.tz);
    reply.code(result.isNewUser ? 201 : 200);
    return ok(result);
  };

  logout = async (req: Req<{ Body: z.infer<typeof RefreshBody> }>, reply: Rep) => {
    await this.c.services.auth.logout(req.body.refreshToken);
    return reply.code(204).send();
  };

  changePassword = async (req: Req<{ Body: z.infer<typeof ChangePasswordBody> }>) => ok(await this.c.services.auth.changePassword(req.user.id, req.body));

  refresh = async (req: Req<{ Body: z.infer<typeof RefreshBody> }>) => ok(await this.c.services.auth.refresh(req.body.refreshToken));
}
