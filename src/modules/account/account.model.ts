import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';

/** Códigos de verificación de email (6 dígitos, guardados con hash). */
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_verif_user_idx').on(t.userId, t.createdAt)],
);

/** Exportaciones de datos personales (Ley 1581). */
export const dataExports = pgTable('data_exports', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text().notNull(), // processing | ready | failed
  fileKey: text(),
  expiresAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
