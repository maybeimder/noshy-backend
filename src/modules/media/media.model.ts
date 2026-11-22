import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';

export const media = pgTable('media', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text().notNull(), // recipeCover | cookedPhoto | avatar
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  storageKey: text().notNull(),
  status: text().notNull().default('pending'), // pending | uploaded | attached
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
});
