import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AuthController } from './auth.controller.js';
import { ChangePasswordBody, LoginBody, OAuthBody, OAuthParams, RefreshBody, RegisterBody } from './auth.dto.js';

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new AuthController(app.container);
  const tags = ['Cuenta y sesión'];
  const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  r.post('/auth/register', { config: strict, schema: { tags, summary: 'Crear cuenta con email', body: RegisterBody } }, (req, rep) => c.register(req, rep));
  r.post('/auth/oauth/:provider', { config: strict, schema: { tags, summary: 'Entrar o registrarse con Google / Apple', params: OAuthParams, body: OAuthBody } }, (req, rep) => c.oauth(req, rep));
  r.post('/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags, summary: 'Iniciar sesión con email', body: LoginBody } }, (req) => c.login(req));
  r.post('/auth/logout', { config: strict, schema: { tags, summary: 'Cerrar esta sesión', body: RefreshBody } }, (req, rep) => c.logout(req, rep));
  r.post('/me/password', { preHandler: [app.authenticate], config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags, summary: 'Cambiar la contraseña (cierra las demás sesiones)', body: ChangePasswordBody } }, (req) => c.changePassword(req));
  r.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { tags, summary: 'Renovar access token', body: RefreshBody } }, (req) => c.refresh(req));
}
