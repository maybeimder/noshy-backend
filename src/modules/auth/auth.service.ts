import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/persistence/persistence';
import type { AuthUser, LoginInput, RegisterInput } from './auth.model';
import { UserLoggedInEvent, UserRegisteredEvent } from './events/auth.events';
import { hashPassword, verifyPassword } from './password';
import { issueToken, verifyToken } from './token';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const publicUser = (user: AuthUser) => ({ id: user.id, name: user.name, email: user.email });

export async function registerUser(input: RegisterInput) {
  const email = normalizeEmail(input.email);

  return db().uow.transaction(async (tx) => {
    if (await db().users.findByEmail(email, tx)) {
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
      password: await hashPassword(input.password),
      createdAt: new Date().toISOString()
    };

    await db().users.insert(user, tx);
    await db().events.append([new UserRegisteredEvent({ userId: user.id, name: user.name, email: user.email })], tx);

    return {
      ok: true,
      data: { user: publicUser(user), token: await issueToken(user.id) }
    } as const;
  });
}

export async function loginUser(input: LoginInput) {
  const email = normalizeEmail(input.email);

  return db().uow.transaction(async (tx) => {
    const user = await db().users.findByEmail(email, tx);
    if (!user || !(await verifyPassword(input.password, user.password))) {
      return {
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales inválidas.'
      } as const;
    }

    await db().events.append([new UserLoggedInEvent({ userId: user.id, email: user.email })], tx);

    return {
      ok: true,
      data: { user: publicUser(user), token: await issueToken(user.id) }
    } as const;
  });
}

// Token inválido, expirado, firmado con otro secreto o de un usuario que ya no existe -> null.
export async function getUserByToken(token: string) {
  const userId = await verifyToken(token);
  return userId ? db().users.findById(userId) : null;
}
