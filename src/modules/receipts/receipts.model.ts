import { pgTable, text, integer, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { stores, ingredients, products } from '../catalog/catalog.model.js';

export const receipts = pgTable(
  'receipts',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull(), // processing | parsed | failed
    storeId: text().references(() => stores.id),
    purchasedAt: timestamp({ withTimezone: true }),
    total: integer(),
    itemsCount: integer(),
    fileKey: text().notNull(),
    contentType: text().notNull(),
    failureReason: text(),
    learned: jsonb().$type<{ brandsCount: number; productsCount: number } | null>(),
    pantryAdded: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('receipts_user_idx').on(t.userId, t.createdAt)],
);

export const receiptItems = pgTable(
  'receipt_items',
  {
    id: text().primaryKey(),
    receiptId: text().notNull().references(() => receipts.id, { onDelete: 'cascade' }),
    rawLabel: text().notNull(),
    brand: text(),
    price: integer().notNull(),
    ingredientId: text().references(() => ingredients.id),
    productId: text().references(() => products.id),
    addToPantry: boolean().notNull().default(true),
  },
  (t) => [index('receipt_items_receipt_idx').on(t.receiptId)],
);
