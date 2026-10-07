// Entrada única (HTTP y RabbitMQ) del módulo de planes.
import { defineHandler } from '../../../core/commands/command-bus';
import { nutritionPlanInputSchema } from '../http/plan.dto';
import { createNutritionPlan, getActiveNutritionPlan, listNutritionPlans, updateActiveNutritionPlan } from '../plan.service';

export const PlanHandlers = {
  create: 'plans.create',
  list: 'plans.list',
  active: 'plans.active',
  updateActive: 'plans.update_active'
} as const;

export const planHandlers = [
  defineHandler({ name: PlanHandlers.create, schema: nutritionPlanInputSchema, execute: ({ userId, data }) => createNutritionPlan(userId, data) }),
  defineHandler({ name: PlanHandlers.list, execute: ({ userId }) => listNutritionPlans(userId) }),
  defineHandler({ name: PlanHandlers.active, execute: ({ userId }) => getActiveNutritionPlan(userId) }),
  defineHandler({
    name: PlanHandlers.updateActive,
    schema: nutritionPlanInputSchema,
    execute: ({ userId, data }) => updateActiveNutritionPlan(userId, data)
  })
];
