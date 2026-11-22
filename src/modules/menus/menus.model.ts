import { pgTable, text, integer, timestamp, date, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { recipes } from '../recipes/recipes.model.js';

export const menus = pgTable(
  'menus',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date({ mode: 'string' }).notNull(),
    status: text().notNull(), // generating | ready | failed
    progress: jsonb().$type<{ stage: string; percent: number }>().notNull().default({ stage: 'restrictions', percent: 0 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('menus_user_idx').on(t.userId, t.weekStart)],
);

export const menuEntries = pgTable(
  'menu_entries',
  {
    id: text().primaryKey(),
    menuId: text().notNull().references(() => menus.id, { onDelete: 'cascade' }),
    localDate: date({ mode: 'string' }).notNull(),
    slot: text().notNull(),
    recipeId: text().notNull().references(() => recipes.id),
    servings: integer().notNull(),
  },
  (t) => [index('menu_entries_menu_idx').on(t.menuId)],
);
