import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

// JWT HS256 firmado. El payload solo lleva el id del usuario (sub): nada sensible viaja en el token.
const ISSUER = 'noshy';
const AUDIENCE = 'noshy-api';
const DEFAULT_EXPIRES_IN = '7d';

type TokenSettings = { secret: Uint8Array; expiresIn: string; ephemeral: boolean };

// Sin configurar se usa un secreto aleatorio por proceso: sirve para tests y desarrollo,
// pero los tokens dejan de valer al reiniciar. El entrypoint configura el secreto real (JWT_SECRET).
let settings: TokenSettings = { secret: randomBytes(32), expiresIn: DEFAULT_EXPIRES_IN, ephemeral: true };

export function configureAuthTokens(options: { secret: string; expiresIn?: string }): void {
  settings = { secret: new TextEncoder().encode(options.secret), expiresIn: options.expiresIn ?? DEFAULT_EXPIRES_IN, ephemeral: false };
}

export function usesEphemeralSecret(): boolean {
  return settings.ephemeral;
}

export function issueToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(settings.expiresIn)
    .sign(settings.secret);
}

// Devuelve el id del usuario si la firma, el emisor, la audiencia y la expiración son válidos; si no, null.
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, settings.secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
