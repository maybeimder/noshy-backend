import { pgTable, text, integer, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { recipes } from '../recipes/recipes.model.js';
import type { CookingStepSnapshot } from './cooking.snapshots.js';

export const cookingSessions = pgTable(
  'cooking_sessions',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipeId: text().notNull().references(() => recipes.id),
    adaptationId: text(),
    servings: integer().notNull(),
    mealSlot: text(),
    status: text().notNull(), // active | completed | abandoned
    currentStepIndex: integer().notNull().default(0),
    steps: jsonb().$type<CookingStepSnapshot[]>().notNull(),
    ingredientUsage: jsonb().$type<{ ingredientId: string; value: number | null; unit: string }[]>().notNull().default([]),
    rating: integer(),
    photoMediaId: text(),
    abandonedReason: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    localDate: text(), // día local de cierre, para racha
  },
  (t) => [index('cooking_user_status_idx').on(t.userId, t.status), index('cooking_user_recipe_idx').on(t.userId, t.recipeId)],
);
