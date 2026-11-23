import { pgTable, text, boolean, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';
import type {
  NutritionTargets,
  PreferencesGoals,
  PreferencesKitchen,
  PreferencesRestrictions,
  PreferencesShopping,
  StoredBiometrics,
  Labeled,
} from '../../infrastructure/database/postgres/types.js';
import { users } from '../auth/auth.model.js';

/** Preferencias guardadas por sección. Cada PATCH reemplaza la sección completa. */
export const userPreferences = pgTable('user_preferences', {
  userId: text().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  goals: jsonb().$type<PreferencesGoals>().notNull(),
  activityLevel: text().notNull(),
  biometrics: jsonb().$type<StoredBiometrics>(),
  kcalTarget: integer().notNull(),
  kcalAdjustedByUser: boolean().notNull().default(false),
  restrictions: jsonb().$type<PreferencesRestrictions>().notNull(),
  favoriteDishIds: jsonb().$type<string[]>().notNull(),
  kitchen: jsonb().$type<PreferencesKitchen>().notNull(),
  shopping: jsonb().$type<PreferencesShopping>().notNull(),
  skippedSteps: jsonb().$type<string[]>().notNull().default([]),
  nutritionTargets: jsonb().$type<NutritionTargets>().notNull(),
  loves: jsonb().$type<Labeled[]>().notNull().default([]),
  likedCuisines: jsonb().$type<Labeled[]>().notNull().default([]),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const onboardingDrafts = pgTable('onboarding_drafts', {
  userId: text().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  currentStep: text().notNull().default('goals'),
  skippedSteps: jsonb().$type<string[]>().notNull().default([]),
  draft: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
