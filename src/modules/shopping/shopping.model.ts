import { pgTable, text, integer, numeric, timestamp, boolean, date, jsonb, index, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { ingredients, products, stores } from '../catalog/catalog.model.js';
import { recipes } from '../recipes/recipes.model.js';
import type { Unit } from '../../core/domain/quantity.js';

export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date({ mode: 'string' }).notNull(),
    status: text().notNull().default('active'), // active | completed
    storeId: text().references(() => stores.id),
    shareToken: text(),
    shareExpiresAt: timestamp({ withTimezone: true }),
    spent: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('shopping_lists_user_idx').on(t.userId, t.status), uniqueIndex('shopping_lists_share_uq').on(t.shareToken)],
);

export const shoppingListRecipes = pgTable(
  'shopping_list_recipes',
  {
    listId: text().notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
    recipeId: text().notNull().references(() => recipes.id),
    servings: integer().notNull(),
    adaptationId: text(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.recipeId] })],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: text().primaryKey(),
    listId: text().notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
    ingredientId: text().notNull().references(() => ingredients.id),
    quantityValue: numeric({ mode: 'number' }).notNull(),
    quantityUnit: text().$type<Unit>().notNull(),
    checked: boolean().notNull().default(false),
    checkedAt: timestamp({ withTimezone: true }),
    productId: text().references(() => products.id),
    estimatedPrice: integer().notNull(),
    actualPrice: integer(),
    sourceRecipeIds: jsonb().$type<string[]>().notNull().default([]),
    carriedOver: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shopping_items_list_idx').on(t.listId)],
);
