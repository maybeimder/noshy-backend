import { pgTable, text, integer, numeric, timestamp, boolean, date, index } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { ingredients, products, stores } from '../catalog/catalog.model.js';
import type { Unit } from '../../core/domain/quantity.js';

export const pantryItems = pgTable(
  'pantry_items',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    ingredientId: text().notNull().references(() => ingredients.id),
    productId: text().references(() => products.id),
    quantityValue: numeric({ mode: 'number' }),
    quantityUnit: text().$type<Unit>(),
    remainingPct: integer(),
    storage: text(), // fridge | pantry | freezer
    expiresOn: date({ mode: 'string' }),
    expiryEstimated: boolean().notNull().default(true),
    source: text().notNull(), // onboarding | receipt | shoppingList | manual
    storeId: text().references(() => stores.id),
    purchasePrice: integer(),
    /** Línea de factura que lo originó (para deshacer desde «Tu factura»). */
    receiptItemId: text(),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pantry_user_storage_idx').on(t.userId, t.storage),
    index('pantry_user_added_idx').on(t.userId, t.addedAt),
    index('pantry_user_ingredient_idx').on(t.userId, t.ingredientId),
  ],
);
