import { z } from 'zod';
import { ACTIVITY_IDS, ALLERGY_IDS, CARE_IDS, DIET_IDS, EQUIPMENT_IDS, GOAL_IDS, ONBOARDING_STEPS, SKILL_IDS } from '../../../core/domain/catalog.js';
import { MoneyInput } from '../../../core/shared/common.dto.js';

export const GoalId = z.enum(GOAL_IDS);
export const ActivityLevel = z.enum(ACTIVITY_IDS);
export const OnboardingStep = z.enum(ONBOARDING_STEPS);

export const Biometrics = z.object({
  weightKg: z.number().min(25).max(350),
  heightCm: z.number().min(100).max(250),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear() - 13),
  sex: z.enum(['female', 'male']).nullable(),
});

export const NutritionPreviewBody = z.object({ goalIds: z.array(GoalId).max(6), activityLevel: ActivityLevel, biometrics: Biometrics.nullish() });

export const GoalsSection = z.object({ ids: z.array(GoalId).max(6), customNote: z.string().max(2000).nullable() });
export const RestrictionsSection = z.object({
  dietStyle: z.enum(DIET_IDS),
  allergyIds: z.array(z.enum(ALLERGY_IDS)).max(10),
  careIds: z.array(z.enum(CARE_IDS)).max(10),
  customExclusions: z.array(z.string().trim().min(1).max(40)).max(50),
});
export const TastesSection = z.object({ favoriteDishIds: z.array(z.string().max(40)).max(50) });
export const KitchenSection = z.object({
  mealsPerDay: z.number().int(),
  maxCookingMinutes: z.number().int().positive().max(600).nullable(),
  skillLevel: z.enum(SKILL_IDS),
  equipmentIds: z.array(z.enum(EQUIPMENT_IDS)).max(10),
});
export const ShoppingSection = z.object({
  storeIds: z.array(z.string().max(40)).min(1).max(10),
  priceQualityBalance: z.number().min(0).max(1),
  weeklyBudget: MoneyInput,
});
export const NutritionSection = z.object({ kcalTarget: z.number().int(), adjustedByUser: z.boolean() });

export const CompleteBody = z.object({
  goals: GoalsSection.nullable(),
  activityLevel: ActivityLevel.nullable(),
  nutrition: NutritionSection.nullable(),
  restrictions: RestrictionsSection.nullable(),
  tastes: TastesSection.nullable(),
  kitchen: KitchenSection.nullable(),
  shopping: ShoppingSection.nullable(),
  skippedSteps: z.array(OnboardingStep).max(6),
});

export const DraftBody = z.object({
  currentStep: OnboardingStep,
  draft: CompleteBody.partial().omit({ skippedSteps: true }),
  skippedSteps: z.array(OnboardingStep).max(6).optional(),
});

export const PreferencesPatchBody = z
  .object({
    goals: GoalsSection,
    activityLevel: ActivityLevel,
    nutrition: NutritionSection,
    restrictions: RestrictionsSection,
    tastes: TastesSection,
    kitchen: KitchenSection,
    shopping: ShoppingSection,
  })
  .partial();
