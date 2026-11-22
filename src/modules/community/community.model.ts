import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';

export const follows = pgTable(
  'follows',
  {
    followerId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    followeeId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('follows_pk').on(t.followerId, t.followeeId)],
);
