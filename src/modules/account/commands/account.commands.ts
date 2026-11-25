import type { Arg } from '../../../core/commands/command-bus.js';
import type { AccountService } from '../account.service.js';

/** Comandos del módulo account. Cuenta: verificación, ajustes, exportación y borrado. */
export const accountCommands = (s: { account: AccountService }) => ({
  'account.verifyEmail': (c: { userId: string; code: string }) => s.account.verifyEmail(c.userId, c.code),
  'account.resendVerification': (c: { userId: string }) => s.account.sendVerification(c.userId, { enforceCooldown: true }),
  'account.updateSettings': (c: { userId: string; patch: Arg<AccountService['updateSettings'], 1> }) => s.account.updateSettings(c.userId, c.patch),
  'account.requestExport': (c: { userId: string }) => s.account.requestExport(c.userId),
  'account.delete': (c: { userId: string }) => s.account.deleteAccount(c.userId),
});
