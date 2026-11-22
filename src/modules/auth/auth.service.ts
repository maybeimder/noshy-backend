import { hash, verify } from '@node-rs/argon2';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { UsersRepository, UserRow } from './auth.repository.js';
import type { OAuthVerifier } from './auth.providers.js';
import type { TokenService, Tokens } from './token.service.js';
import { Errors } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  onboardingStatus: string;
  createdAt: string;
};

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  emailVerified: u.emailVerified,
  onboardingStatus: u.onboardingStatus,
  createdAt: u.createdAt.toISOString(),
});

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly users: UsersRepository,
    private readonly tokens: TokenService,
    private readonly oauth: OAuthVerifier,
    private readonly outbox: Outbox,
  ) {}

  async register(input: { name: string; email: string; password: string; acceptedTermsVersion: string; grammaticalGender?: string | null }, tz: string) {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw Errors.conflict('EMAIL_TAKEN', 'Ya existe una cuenta con ese email.');
    const passwordHash = await hash(input.password);
    const result = await this.db.transaction(async (tx) => {
      const user = await this.users.create(tx, {
        id: newId('user'),
        name: input.name.trim(),
        email,
        passwordHash,
        acceptedTermsVersion: input.acceptedTermsVersion,
        grammaticalGender: input.grammaticalGender ?? null,
        timezone: tz,
      });
      const tokens = await this.tokens.issue(tx, user.id);
      await this.outbox.record(tx, 'user.registered', { userId: user.id, method: 'password' });
      return { user: toPublicUser(user), tokens };
    });
    this.outbox.kick();
    return result;
  }

  async login(input: { email: string; password: string }, tz: string): Promise<{ user: PublicUser; tokens: Tokens }> {
    const user = await this.users.findByEmail(input.email.trim().toLowerCase());
    const ok = user?.passwordHash ? await verify(user.passwordHash, input.password).catch(() => false) : false;
    if (!user || !ok) throw Errors.unauthorized('INVALID_CREDENTIALS', 'Email o contraseña incorrectos.');
    const tokens = await this.tokens.issue(this.db, user.id);
    if (user.timezone !== tz) await this.users.update(this.db, user.id, { timezone: tz });
    return { user: toPublicUser(user), tokens };
  }

  async refresh(refreshToken: string) {
    const tokens = await this.db.transaction((tx) => this.tokens.rotate(tx, refreshToken));
    return { tokens };
  }

  async oauthSignIn(provider: 'google' | 'apple', input: { idToken: string; nonce?: string | null; name?: string | null; acceptedTermsVersion: string }, tz: string) {
    let profile;
    try {
      profile = await this.oauth.verify(provider, input.idToken, input.nonce);
    } catch {
      throw Errors.unauthorized('INVALID_PROVIDER_TOKEN', 'No pudimos verificar tu cuenta con el proveedor.');
    }
    const identity = await this.users.findIdentity(provider, profile.subject);
    if (identity) {
      const user = (await this.users.findById(identity.userId))!;
      const tokens = await this.tokens.issue(this.db, user.id);
      return { isNewUser: false, user: toPublicUser(user), tokens };
    }
    if (profile.email) {
      const existing = await this.users.findByEmail(profile.email);
      if (existing?.passwordHash) {
        throw Errors.conflict('EMAIL_LINKED_TO_PASSWORD', 'Ese email ya tiene cuenta con contraseña. Inicia sesión con tu contraseña para vincularla.');
      }
      if (existing) {
        await this.users.linkIdentity(this.db, { id: newId('identity'), userId: existing.id, provider, subject: profile.subject });
        const tokens = await this.tokens.issue(this.db, existing.id);
        return { isNewUser: false, user: toPublicUser(existing), tokens };
      }
    }
    const name = (input.name ?? profile.name ?? '').trim() || 'Chef';
    const result = await this.db.transaction(async (tx) => {
      const user = await this.users.create(tx, {
        id: newId('user'),
        name,
        email: profile.email ?? `${provider}.${profile.subject}@users.noshy.app`,
        emailVerified: profile.emailVerified,
        acceptedTermsVersion: input.acceptedTermsVersion,
        timezone: tz,
      });
      await this.users.linkIdentity(tx, { id: newId('identity'), userId: user.id, provider, subject: profile.subject });
      const tokens = await this.tokens.issue(tx, user.id);
      await this.outbox.record(tx, 'user.registered', { userId: user.id, method: provider });
      return { isNewUser: true, user: toPublicUser(user), tokens };
    });
    this.outbox.kick();
    return result;
  }
}
