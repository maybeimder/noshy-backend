import type { Unit } from '../../../core/domain/quantity.js';
import type { Biometrics, MacrosWithFiber, Macros } from '../../../core/domain/nutrition.js';

/** Paso de receta tal como se guarda (cantidades base, sin escalar). */
export type StepIngredientTemplate = {
  ingredientId: string | null;
  label?: string;
  prep: string | null;
  value: number | null;
  unit: Unit;
  fromStepIndex?: number;
};
export type SubStepTemplate = {
  shortLabel: string;
  text: string;
  timerSeconds: number | null;
  heatLevel: number;
};
export type StepTemplate = {
  title: string;
  durationSeconds: number;
  heatLevel: number;
  equipment: string | null;
  ingredients: StepIngredientTemplate[];
  subSteps: SubStepTemplate[];
  doneWhen: string | null;
};
/** Paso simple de una receta creada por un usuario (antes de estructurarla). */
export type UserStep = { text: string; timerSeconds?: number; heat?: 'low' | 'medium' | 'high' };

export type ChefConsultable = { enabled: boolean; useMyStyle: boolean; suggestSubstitutes: boolean };
export type Labeled = { id: string; label: string };
export type SubstitutionJson = { from: { ingredientId: string; label: string }; to: { ingredientId: string; label: string }; reason: string };

export type PreferencesGoals = { ids: string[]; customNote: string | null };
export type PreferencesRestrictions = {
  dietStyle: string;
  allergyIds: string[];
  careIds: string[];
  customExclusions: string[];
  /** Ingrediente reconocido para cada texto de `customExclusions` (null si no hubo match). */
  customExclusionIds?: (string | null)[];
};
export type PreferencesKitchen = { mealsPerDay: number; maxCookingMinutes: number | null; skillLevel: string; equipmentIds: string[] };
export type PreferencesShopping = { storeIds: string[]; priceQualityBalance: number; weeklyBudget: { amount: number; currency: 'COP' } };
/** Dato de salud (Ley 1581): se guarda solo con la versión del consentimiento aceptado. */
export type StoredBiometrics = Biometrics & { consentVersion: string; consentedAt: string };
export type NutritionTargets = MacrosWithFiber & { source: 'suggested' | 'adjusted' | 'recalculated' };
export type { Macros, MacrosWithFiber };

export type UserSettings = {
  chef: { tone: 'direct' | 'conversational'; proactivity: 'all' | 'important' | 'none'; readStepsAloud: boolean; units: 'metric' | 'imperial' };
  notifications: { expiring: boolean; dailyIdeas: boolean; community: boolean };
};
export const DEFAULT_SETTINGS: UserSettings = {
  chef: { tone: 'conversational', proactivity: 'all', readStepsAloud: true, units: 'metric' },
  notifications: { expiring: true, dailyIdeas: true, community: true },
};
