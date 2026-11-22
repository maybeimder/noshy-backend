import { DEFAULT_SETTINGS } from '../../infrastructure/database/postgres/types.js';
import { pgTable, text, boolean, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { UserSettings } from '../../infrastructure/database/postgres/types.js';

/** Cuentas, identidades OAuth y refresh tokens. Las demás tablas por usuario viven en su módulo. */
export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    lastName: text(),
    email: text().notNull(),
    passwordHash: text(),
    emailVerified: boolean().notNull().default(false),
    grammaticalGender: text(), // feminine | masculine | neutral | null (Q22)
    onboardingStatus: text().notNull().default('pending'), // pending | inProgress | completed
    acceptedTermsVersion: text().notNull(),
    avatarUrl: text(),
    /** Última zona horaria vista (X-Timezone). La usan los workers, que no tienen request. */
    timezone: text().notNull().default('America/Bogota'),
    /** Ajustes: tono e iniciativa del chef, voz, unidades y notificaciones. */
    settings: jsonb().$type<UserSettings>().notNull().default(DEFAULT_SETTINGS),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const oauthIdentities = pgTable(
  'oauth_identities',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    subject: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('oauth_provider_subject_uq').on(t.provider, t.subject)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    familyId: text().notNull(),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refresh_token_hash_uq').on(t.tokenHash), index('refresh_family_idx').on(t.familyId)],
);
