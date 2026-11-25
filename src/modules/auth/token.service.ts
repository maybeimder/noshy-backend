import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import type { UsersRepository } from './auth.repository.js';
import { Errors } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

export type Tokens = { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Access token: JWT HS256 corto (`sub` = userId).
 * Refresh token: opaco, de un solo uso, rotado por familia. Reusar uno ya rotado revoca toda la familia.
 */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly accessTtlSeconds: number,
    private readonly refreshTtlDays: number,
    private readonly users: UsersRepository,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setIssuer('noshy')
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<{ sub: string }> {
    const { payload } = await jwtVerify(token, this.key, { issuer: 'noshy', algorithms: ['HS256'] });
    if (!payload.sub) throw Errors.unauthorized();
    return { sub: payload.sub };
  }

  async issue(exec: Executor, userId: string, familyId = newId('refreshToken')): Promise<Tokens> {
    const raw = `rt_${randomBytes(32).toString('base64url')}`;
    await this.users.insertRefreshToken(exec, {
      id: newId('refreshToken'),
      userId,
      familyId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + this.refreshTtlDays * 86_400_000),
    });
    return { accessToken: await this.signAccess(userId), refreshToken: raw, tokenType: 'Bearer', expiresIn: this.accessTtlSeconds };
  }

  /** Cierra la sesión de ese token. Uno desconocido no es un error: ya no hay sesión que cerrar. */
  async revoke(raw: string) {
    const row = await this.users.findRefreshByHash(sha256(raw));
    if (row) await this.users.revokeFamily(row.familyId);
  }

  async rotate(exec: Executor, raw: string): Promise<Tokens> {
    const invalid = () => Errors.unauthorized('REFRESH_TOKEN_INVALID', 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
    const row = await this.users.findRefreshByHash(sha256(raw));
    if (!row || row.revokedAt || row.expiresAt < new Date()) throw invalid();
    if (row.usedAt) {
      await this.users.revokeFamily(row.familyId);
      throw invalid();
    }
    const claimed = await this.users.markRefreshUsed(exec, row.id);
    if (!claimed) {
      await this.users.revokeFamily(row.familyId);
      throw invalid();
    }
    return this.issue(exec, row.userId, row.familyId);
  }
}
