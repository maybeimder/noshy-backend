import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { ExportParams, SettingsPatchBody, VerifyEmailBody } from './account.dto.js';

export class AccountController {
  constructor(private readonly c: Container) {}

  verifyEmail = async (req: Req<{ Body: z.infer<typeof VerifyEmailBody> }>) => ok(await this.c.commands.execute('account.verifyEmail', { userId: req.user.id, code: req.body.code }));

  resendEmail = async (req: Req, reply: Rep) => {
    await this.c.commands.execute('account.resendVerification', { userId: req.user.id });
    return reply.code(204).send();
  };

  settings = async (req: Req) => ok(await this.c.services.account.settings(req.user.id));

  patchSettings = async (req: Req<{ Body: z.infer<typeof SettingsPatchBody> }>) => ok(await this.c.commands.execute('account.updateSettings', { userId: req.user.id, patch: req.body }));

  requestExport = async (req: Req, reply: Rep) => {
    reply.code(202);
    return ok(await this.c.commands.execute('account.requestExport', { userId: req.user.id }));
  };

  exportStatus = async (req: Req<{ Params: z.infer<typeof ExportParams> }>) => ok(await this.c.services.account.exportStatus(req.user.id, req.params.exportId));

  exportDownload = async (req: Req<{ Params: z.infer<typeof ExportParams> }>, reply: Rep) => {
    const file = await this.c.services.account.exportFile(req.user.id, req.params.exportId);
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="noshy-datos-${req.params.exportId}.json"`)
      .send(file);
  };

  deleteAccount = async (req: Req, reply: Rep) => {
    await this.c.commands.execute('account.delete', { userId: req.user.id });
    return reply.code(204).send();
  };
}
