import { pgTable, text, integer, jsonb, numeric, timestamp, boolean, index, serial, primaryKey } from 'drizzle-orm/pg-core';
import { users } from '../auth/auth.model.js';
import { ingredients } from '../catalog/catalog.model.js';
import type { ChefConsultable, Labeled, StepTemplate, SubstitutionJson, UserStep } from '../../infrastructure/database/postgres/types.js';
import type { Unit } from '../../core/domain/quantity.js';
import type { Macros } from '../../core/domain/nutrition.js';

export const recipes = pgTable(
  'recipes',
  {
    id: text().primaryKey(),
    authorType: text().notNull(), // noshy | user | chef
    authorId: text().references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull(), // draft | inReview | published | rejected
    title: text().notNull().default(''),
    slug: text(),
    imageUrl: text(),
    coverMediaId: text(),
    cuisineId: text(),
    cuisineLabel: text(),
    dishId: text(),
    tags: jsonb().$type<string[]>().notNull().default([]),
    flavorTags: jsonb().$type<string[]>().notNull().default([]),
    mealSlots: jsonb().$type<string[]>().notNull().default(['lunch', 'dinner']),
    timeMin: integer(),
    timeMax: integer(),
    baseServings: integer().notNull().default(2),
    difficulty: text(),
    steps: jsonb().$type<StepTemplate[]>().notNull().default([]),
    userSteps: jsonb().$type<UserStep[]>().notNull().default([]),
    nutritionPerServing: jsonb().$type<Macros | null>(),
    nutritionStatus: text().notNull().default('empty'),
    chefConsultable: jsonb().$type<ChefConsultable>().notNull().default({ enabled: false, useMyStyle: false, suggestSubstitutes: false }),
    ratingSum: integer().notNull().default(0),
    ratingCount: integer().notNull().default(0),
    likesCount: integer().notNull().default(0),
    commentsCount: integer().notNull().default(0),
    rejectionReason: text(),
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recipes_author_idx').on(t.authorId, t.status), index('recipes_status_pub_idx').on(t.status, t.publishedAt)],
);

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: serial().primaryKey(),
    recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    ingredientId: text().notNull().references(() => ingredients.id),
    value: numeric({ mode: 'number' }),
    unit: text().$type<Unit>().notNull(),
    prep: text(),
    position: integer().notNull(),
  },
  (t) => [index('recipe_ingredients_recipe_idx').on(t.recipeId)],
);

/** Adaptación vigente de una receta para un usuario. */
export const recipeAdaptations = pgTable(
  'recipe_adaptations',
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    reasons: jsonb().$type<Labeled[]>().notNull(),
    substitutions: jsonb().$type<SubstitutionJson[]>().notNull(),
    stepNotes: jsonb().$type<{ stepIndex: number; text: string }[]>().notNull().default([]),
    source: text().notNull(), // auto | proposal
    preferencesHash: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('adaptations_user_recipe_idx').on(t.userId, t.recipeId, t.active)],
);

/** Propuesta del chef («versión airfryer») que el usuario puede aplicar durante 24 h. */
export const adaptationProposals = pgTable('adaptation_proposals', {
  id: text().primaryKey(),
  userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  summary: text().notNull(),
  changes: jsonb().$type<string[]>().notNull(),
  stepNotes: jsonb().$type<{ stepIndex: number; text: string }[]>().notNull().default([]),
  appliedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const savedRecipes = pgTable(
  'saved_recipes',
  {
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] })],
);

export const likedRecipes = pgTable(
  'liked_recipes',
  {
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.recipeId] }), index('liked_recipe_time_idx').on(t.recipeId, t.createdAt)],
);

export const comments = pgTable(
  'comments',
  {
    id: text().primaryKey(),
    recipeId: text().notNull().references(() => recipes.id, { onDelete: 'cascade' }),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    likes: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_recipe_idx').on(t.recipeId, t.createdAt)],
);

