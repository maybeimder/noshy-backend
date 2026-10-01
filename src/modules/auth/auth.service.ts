import { randomUUID } from 'node:crypto';
import type { AuthUser, LoginInput, RegisterInput } from './auth.model';

const users = new Map<string, AuthUser>();
const tokenByUserId = new Map<string, string>();

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function registerUser(input: RegisterInput) {
  const email = normalizeEmail(input.email);

  if (users.has(email)) {
    return {
      ok: false,
      code: 'USER_ALREADY_EXISTS',
      message: 'El usuario ya existe.'
    } as const;
  }

  const user: AuthUser = {
    id: randomUUID(),
    name: input.name.trim(),
    email,
    password: input.password,
    createdAt: new Date().toISOString()
  };

  users.set(email, user);

  const token = `noshy_${user.id}`;
  tokenByUserId.set(user.id, token);

  return {
    ok: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      token
    }
  } as const;
}

export function loginUser(input: LoginInput) {
  const email = normalizeEmail(input.email);
  const user = users.get(email);

  if (!user || user.password !== input.password) {
    return {
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Credenciales inválidas.'
    } as const;
  }

  const token = tokenByUserId.get(user.id) ?? `noshy_${user.id}`;

  return {
    ok: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      token
    }
  } as const;
}

export function getUserByToken(token: string) {
  if (!token.startsWith('noshy_')) {
    return null;
  }

  const userId = token.replace('noshy_', '');
  const user = [...users.values()].find((entry) => entry.id === userId) ?? null;

  return user;
}
