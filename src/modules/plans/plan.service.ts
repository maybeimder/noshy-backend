import { randomUUID } from 'node:crypto';
import type { NutritionPlan, NutritionPlanInput } from './plan.model';

const nutritionPlansByUserId = new Map<string, NutritionPlan[]>();

export function createNutritionPlan(userId: string, input: NutritionPlanInput) {
  const now = new Date().toISOString();
  const plan: NutritionPlan = {
    id: randomUUID(),
    userId,
    objective: input.objective,
    targets: input.targets,
    restrictions: input.restrictions?.map((restriction) => restriction.trim()).filter(Boolean) ?? [],
    mealsPerDay: input.mealsPerDay,
    createdAt: now,
    updatedAt: now
  };
  const plans = nutritionPlansByUserId.get(userId) ?? [];
  plans.push(plan);
  nutritionPlansByUserId.set(userId, plans);
  return plan;
}

export function listNutritionPlans(userId: string) {
  return nutritionPlansByUserId.get(userId) ?? [];
}

export function getActiveNutritionPlan(userId: string) {
  const plans = listNutritionPlans(userId);
  return plans.length > 0 ? plans[plans.length - 1] : null;
}

export function updateActiveNutritionPlan(userId: string, input: NutritionPlanInput) {
  const active = getActiveNutritionPlan(userId);
  if (!active) {
    return { ok: false, code: 'NUTRITION_PLAN_NOT_FOUND', message: 'No existe un plan nutricional activo.' } as const;
  }
  active.objective = input.objective;
  active.targets = input.targets;
  active.restrictions = input.restrictions?.map((restriction) => restriction.trim()).filter(Boolean) ?? [];
  active.mealsPerDay = input.mealsPerDay;
  active.updatedAt = new Date().toISOString();
  return { ok: true, data: active } as const;
}
