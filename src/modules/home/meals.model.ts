import { pgTable, text, integer, numeric, timestamp, boolean, date, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { recipes } from '../recipes/recipes.model.js';

/** Comidas registradas por día (Inicio › Mi día). */
export const mealLogs = pgTable(
  'meal_logs',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    localDate: date({ mode: 'string' }).notNull(),
    slot: text().notNull(),
    recipeId: text().references(() => recipes.id),
    label: text().notNull(),
    servings: numeric({ mode: 'number' }).notNull().default(1),
    kcal: integer().notNull().default(0),
    proteinG: integer().notNull().default(0),
    carbsG: integer().notNull().default(0),
    fatG: integer().notNull().default(0),
    skipped: boolean().notNull().default(false),
    source: text().notNull(), // manual | cooking
    cookingSessionId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('meal_logs_user_date_idx').on(t.userId, t.localDate)],
);
