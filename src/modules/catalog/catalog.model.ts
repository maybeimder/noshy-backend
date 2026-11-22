import { pgTable, text, integer, jsonb, numeric, timestamp, primaryKey, index, boolean } from 'drizzle-orm/pg-core';
import type { MacrosWithFiber } from '../../infrastructure/database/postgres/types.js';
import type { Unit } from '../../core/domain/quantity.js';

export const stores = pgTable('stores', {
  id: text().primaryKey(),
  name: text().notNull(),
  logoUrl: text().notNull(),
  country: text().notNull().default('CO'),
  sort: integer().notNull().default(0),
});

export const dishes = pgTable('dishes', {
  id: text().primaryKey(),
  label: text().notNull(),
  imageUrl: text().notNull(),
  cuisineId: text(),
  flavorTags: jsonb().$type<string[]>().notNull().default([]),
  sort: integer().notNull().default(0),
});

export const ingredients = pgTable(
  'ingredients',
  {
    id: text().primaryKey(),
    label: text().notNull(),
    icon: text().notNull(),
    categoryId: text().notNull(), // produce | protein | dairy | staples | spices | bakery | drinks
    categoryLabel: text().notNull(),
    defaultStorage: text().notNull(), // fridge | pantry | freezer
    shelfLifeDays: integer().notNull(),
    allergens: jsonb().$type<string[]>().notNull().default([]),
    dietFlags: jsonb().$type<string[]>().notNull().default([]),
    flavorTags: jsonb().$type<string[]>().notNull().default([]),
    nutritionPer100g: jsonb().$type<MacrosWithFiber | null>(),
    gramsPerUnit: jsonb().$type<Partial<Record<Unit, number>>>().notNull().default({}),
    unitLabel: jsonb().$type<[string, string] | null>(),
    defaultUnit: text().$type<Unit>().notNull(),
    allowedUnits: jsonb().$type<Unit[]>().notNull(),
    typicalPack: jsonb().$type<{ value: number; unit: Unit; label: string }>().notNull(),
    /** Básicos de cocina (sal, aceite, especias): no cuentan en «4/5 en tu despensa». */
    isBasic: boolean().notNull().default(false),
    searchText: text().notNull(),
  },
  (t) => [index('ingredients_search_idx').on(t.searchText)],
);

/** `reason` = alérgeno o bandera de dieta que resuelve, o `moreProtein`. */
export const ingredientSubstitutes = pgTable(
  'ingredient_substitutes',
  {
    ingredientId: text().notNull().references(() => ingredients.id),
    substituteId: text().notNull().references(() => ingredients.id),
    reason: text().notNull(),
    priority: integer().notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.ingredientId, t.substituteId, t.reason] })],
);

export const products = pgTable(
  'products',
  {
    id: text().primaryKey(),
    ingredientId: text().notNull().references(() => ingredients.id),
    brand: text().notNull(),
    label: text().notNull(),
    packValue: numeric({ mode: 'number' }).notNull(),
    packUnit: text().$type<Unit>().notNull(),
    packLabel: text().notNull(),
    tags: jsonb().$type<string[]>().notNull().default([]),
  },
  (t) => [index('products_ingredient_idx').on(t.ingredientId)],
);

export const productPrices = pgTable(
  'product_prices',
  {
    productId: text().notNull().references(() => products.id),
    storeId: text().notNull().references(() => stores.id),
    price: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.storeId] })],
);
