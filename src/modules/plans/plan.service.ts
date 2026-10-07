import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/persistence/persistence';
import { NutritionPlanCreatedEvent, NutritionPlanUpdatedEvent } from './events/plan.events';
import type { NutritionPlan, NutritionPlanInput } from './plan.model';

const cleanRestrictions = (input: NutritionPlanInput) =>
  input.restrictions?.map((restriction) => restriction.trim()).filter(Boolean) ?? [];

export async function createNutritionPlan(userId: string, input: NutritionPlanInput) {
  const now = new Date().toISOString();
  const plan: NutritionPlan = {
    id: randomUUID(),
    userId,
    objective: input.objective,
    targets: input.targets,
    restrictions: cleanRestrictions(input),
    mealsPerDay: input.mealsPerDay,
    createdAt: now,
    updatedAt: now
  };

  return db().uow.transaction(async (tx) => {
    await db().plans.insert(plan, tx);
    await db().events.append([new NutritionPlanCreatedEvent({ userId, plan })], tx);
    return plan;
  });
}

export function listNutritionPlans(userId: string) {
  return db().plans.listByUser(userId);
}

export async function getActiveNutritionPlan(userId: string) {
  const plans = await listNutritionPlans(userId);
  return plans.length > 0 ? plans[plans.length - 1] : null;
}

export async function updateActiveNutritionPlan(userId: string, input: NutritionPlanInput) {
  return db().uow.transaction(async (tx) => {
    const plans = await db().plans.listByUser(userId, tx);
    const active = plans.length > 0 ? plans[plans.length - 1] : null;
    if (!active) {
      return { ok: false, code: 'NUTRITION_PLAN_NOT_FOUND', message: 'No existe un plan nutricional activo.' } as const;
    }

    const updated: NutritionPlan = {
      ...active,
      objective: input.objective,
      targets: input.targets,
      restrictions: cleanRestrictions(input),
      mealsPerDay: input.mealsPerDay,
      updatedAt: new Date().toISOString()
    };
    await db().plans.update(updated, tx);
    await db().events.append([new NutritionPlanUpdatedEvent({ userId, plan: updated })], tx);
    return { ok: true, data: updated } as const;
  });
}
