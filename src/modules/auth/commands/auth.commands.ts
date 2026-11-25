import type { Arg } from '../../../core/commands/command-bus.js';
import type { AuthService } from '../auth.service.js';

/** Comandos del módulo auth. Registro, sesión y contraseña. */
export const authCommands = (s: { auth: AuthService }) => ({
  'auth.register': (c: { input: Arg<AuthService['register'], 0>; tz: string }) => s.auth.register(c.input, c.tz),
  'auth.login': (c: { input: Arg<AuthService['login'], 0>; tz: string }) => s.auth.login(c.input, c.tz),
  'auth.oauthSignIn': (c: { provider: Arg<AuthService['oauthSignIn'], 0>; input: Arg<AuthService['oauthSignIn'], 1>; tz: string }) => s.auth.oauthSignIn(c.provider, c.input, c.tz),
  'auth.logout': (c: { refreshToken: string }) => s.auth.logout(c.refreshToken),
  'auth.changePassword': (c: { userId: string; input: Arg<AuthService['changePassword'], 1> }) => s.auth.changePassword(c.userId, c.input),
  'auth.refresh': (c: { refreshToken: string }) => s.auth.refresh(c.refreshToken),
});
