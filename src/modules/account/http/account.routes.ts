import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AccountController } from './account.controller.js';
import { DeleteAccountBody, ExportParams, SettingsPatchBody, VerifyEmailBody } from './account.dto.js';

export async function accountRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new AccountController(app.container);
  const auth = [app.authenticate];

  const vTags = ['Cuenta y sesión'];
  r.post('/auth/email/verify', { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } }, schema: { tags: vTags, summary: 'Verificar email con el código de 6 dígitos', body: VerifyEmailBody } }, (req) =>
    c.verifyEmail(req),
  );
  r.post('/auth/email/resend', { preHandler: auth, schema: { tags: vTags, summary: 'Reenviar el código (1 por minuto)' } }, (req, rep) => c.resendEmail(req, rep));

  const sTags = ['Ajustes'];
  r.get('/me/settings', { preHandler: auth, schema: { tags: sTags, summary: 'Cuenta, chef y notificaciones' } }, (req) => c.settings(req));
  r.patch('/me/settings', { preHandler: auth, schema: { tags: sTags, summary: 'Cambiar ajustes por sección', body: SettingsPatchBody } }, (req) => c.patchSettings(req));
  r.post('/me/data-exports', { preHandler: auth, config: { rateLimit: { max: 3, timeWindow: '1 day' } }, schema: { tags: sTags, summary: 'Descargar mis datos (asíncrono)' } }, (req, rep) => c.requestExport(req, rep));
  r.get('/me/data-exports/:exportId', { preHandler: auth, schema: { tags: sTags, summary: 'Estado de la exportación', params: ExportParams } }, (req) => c.exportStatus(req));
  r.get('/me/data-exports/:exportId/download', { preHandler: auth, schema: { tags: sTags, summary: 'Descargar el JSON', params: ExportParams } }, (req, rep) => c.exportDownload(req, rep));
  r.delete('/me', { preHandler: auth, schema: { tags: sTags, summary: 'Eliminar mi cuenta (Ley 1581)', body: DeleteAccountBody } }, (req, rep) => c.deleteAccount(req, rep));
}
