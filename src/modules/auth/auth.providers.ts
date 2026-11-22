import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Verifica idTokens de Google y Apple contra sus JWKS públicos. */
export type OAuthProfile = { subject: string; email: string | null; emailVerified: boolean; name: string | null };

export interface OAuthVerifier {
  verify(provider: 'google' | 'apple', idToken: string, nonce?: string | null): Promise<OAuthProfile>;
}

const ISSUERS = {
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'] },
  apple: { jwks: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'] },
} as const;

export class JwksOAuthVerifier implements OAuthVerifier {
  private readonly sets = {
    google: createRemoteJWKSet(new URL(ISSUERS.google.jwks)),
    apple: createRemoteJWKSet(new URL(ISSUERS.apple.jwks)),
  };

  constructor(private readonly audiences: { google: string[]; apple: string[] }) {}

  async verify(provider: 'google' | 'apple', idToken: string, nonce?: string | null): Promise<OAuthProfile> {
    const audience = this.audiences[provider];
    if (audience.length === 0) throw new Error(`No hay client IDs configurados para ${provider}`);
    const { payload } = await jwtVerify(idToken, this.sets[provider], { issuer: [...ISSUERS[provider].iss], audience });
    if (provider === 'apple' && nonce) {
      const { createHash } = await import('node:crypto');
      const hashed = createHash('sha256').update(nonce).digest('hex');
      if (payload.nonce !== hashed && payload.nonce !== nonce) throw new Error('nonce no coincide');
    }
    return {
      subject: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  }
}
