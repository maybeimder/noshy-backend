// Reacciona a eventos de otros cosos, entrada, funciona como el controller pero para eventos.
// Lo despachan tanto el controller HTTP como el consumer de RabbitMQ (CommandBus).
import { defineHandler } from '../../../core/commands/command-bus';
import { getUserByToken, loginUser, registerUser } from '../auth.service';
import { loginSchema, registerSchema } from '../http/auth.dto';

export const AuthHandlers = {
  register: 'auth.register',
  login: 'auth.login',
  me: 'auth.me'
} as const;

export const authHandlers = [
  defineHandler({ name: AuthHandlers.register, schema: registerSchema, requiresUser: false, execute: ({ data }) => registerUser(data) }),
  defineHandler({ name: AuthHandlers.login, schema: loginSchema, requiresUser: false, execute: ({ data }) => loginUser(data) }),
  defineHandler({
    name: AuthHandlers.me,
    params: ['token'],
    requiresUser: false,
    execute: ({ params }) => {
      const user = getUserByToken(params.token!);
      return user ? { id: user.id, name: user.name, email: user.email } : null;
    }
  })
];
