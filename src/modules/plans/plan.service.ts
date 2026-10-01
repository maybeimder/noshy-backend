import { randomUUID } from 'node:crypto';
import type { Plan, PlanInput, ShoppingList } from './plan.model';

const plansByUserId = new Map<string, Plan[]>();
const shoppingListsByUserId = new Map<string, ShoppingList[]>();

const mealTypes = ['breakfast', 'lunch', 'dinner'] as const;

export function generatePlan(userId: string, input: PlanInput) {
  const plan: Plan = {
    id: randomUUID(),
    userId,
    days: Number(input.days),
    mealsPerDay: Number(input.mealsPerDay),
    goals: input.goals.map((goal) => goal.trim()).filter(Boolean),
    meals: [],
    createdAt: new Date().toISOString()
  };

  for (let day = 1; day <= plan.days; day += 1) {
    for (let mealIndex = 0; mealIndex < plan.mealsPerDay; mealIndex += 1) {
      const type = mealTypes[mealIndex % mealTypes.length];
      plan.meals.push({
        id: randomUUID(),
        day,
        type,
        title: `${type[0].toUpperCase()}${type.slice(1)} for day ${day}`
      });
    }
  }

  const plans = plansByUserId.get(userId) ?? [];
  plans.push(plan);
  plansByUserId.set(userId, plans);

  return plan;
}

export function listPlans(userId: string) {
  return plansByUserId.get(userId) ?? [];
}

export function createShoppingList(userId: string, planId: string) {
  const plan = (plansByUserId.get(userId) ?? []).find((entry) => entry.id === planId);

  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  const items = plan.meals.map((meal) => ({
    name: meal.title,
    quantity: 1,
    unit: 'serving'
  }));

  const list: ShoppingList = {
    id: randomUUID(),
    userId,
    planId: plan.id,
    items,
    createdAt: new Date().toISOString()
  };

  const existing = shoppingListsByUserId.get(userId) ?? [];
  existing.push(list);
  shoppingListsByUserId.set(userId, existing);

  return { ok: true, data: list } as const;
}
