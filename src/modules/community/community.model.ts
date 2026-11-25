import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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

/** Denuncias de recetas y comentarios, para revisarlas a mano. Sin llave al contenido: puede borrarse antes. */
export const contentReports = pgTable(
  'content_reports',
  {
    id: text().primaryKey(),
    reporterId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text().notNull(), // recipe | comment
    targetId: text().notNull(),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('content_reports_uq').on(t.reporterId, t.targetType, t.targetId), index('content_reports_target_idx').on(t.targetType, t.targetId)],
);
