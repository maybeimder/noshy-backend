import { pgTable, text, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';

export const nudges = pgTable(
  'nudges',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    placement: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    action: jsonb().$type<Record<string, unknown>>().notNull(),
    dedupeKey: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    dismissedAt: timestamp({ withTimezone: true }),
    dismissReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('nudges_dedupe_uq').on(t.userId, t.dedupeKey), index('nudges_user_placement_idx').on(t.userId, t.placement)],
);
