import { randomUUID } from 'node:crypto';
import type { Recipe } from '../recipes/recipe.model';
import type { NutritionPlan, NutritionPlanInput, Plan, PlanGeneration, PlanInput, ShoppingList } from './plan.model';

const plansByUserId = new Map<string, Plan[]>();
const shoppingListsByUserId = new Map<string, ShoppingList[]>();
const nutritionPlansByUserId = new Map<string, NutritionPlan[]>();

const mealTypes = ['breakfast', 'lunch', 'dinner'] as const;

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

function buildPlan(userId: string, input: PlanInput, recipes: Recipe[], generationId: string, offset: number) {
  const plan: Plan = {
    id: randomUUID(),
    userId,
    generationId,
    status: 'candidate',
    days: Number(input.days),
    mealsPerDay: Number(input.mealsPerDay),
    goals: input.goals.map((goal) => goal.trim()).filter(Boolean),
    meals: [],
    createdAt: new Date().toISOString()
  };

  for (let day = 1; day <= plan.days; day += 1) {
    for (let mealIndex = 0; mealIndex < plan.mealsPerDay; mealIndex += 1) {
      const type = mealTypes[mealIndex % mealTypes.length];
      const recipe = recipes[(mealIndex + offset) % recipes.length];
      plan.meals.push({
        id: randomUUID(),
        day,
        type,
        title: recipe?.title ?? `${type[0].toUpperCase()}${type.slice(1)} for day ${day}`,
        recipeId: recipe.id,
        ingredients: recipe.ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit
        })),
        servings: 1
      });
    }
  }

  return plan;
}

export function generatePlanAlternatives(userId: string, input: PlanInput, recipes: Recipe[]) {
  const generationId = randomUUID();
  const plans = [0, 1, 2].map((offset) => buildPlan(userId, input, recipes, generationId, offset));
  const existing = plansByUserId.get(userId) ?? [];
  existing.push(...plans);
  plansByUserId.set(userId, existing);

  return { generationId, plans } satisfies PlanGeneration;
}

export function listPlans(userId: string) {
  return plansByUserId.get(userId) ?? [];
}

export function listPlanGeneration(userId: string, generationId: string) {
  return (plansByUserId.get(userId) ?? []).filter((plan) => plan.generationId === generationId);
}

export function getPlanById(userId: string, planId: string) {
  return (plansByUserId.get(userId) ?? []).find((plan) => plan.id === planId) ?? null;
}

export function completePlanMeal(userId: string, planId: string, mealId: string) {
  const plan = getPlanById(userId, planId);
  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  if (plan.status !== 'selected') {
    return { ok: false, code: 'PLAN_NOT_SELECTED', message: 'Debes seleccionar el plan antes de completar una comida.' } as const;
  }

  const meal = plan.meals.find((entry) => entry.id === mealId);
  if (!meal) {
    return { ok: false, code: 'MEAL_NOT_FOUND', message: 'No existe la comida solicitada.' } as const;
  }

  if (meal.completedAt) {
    return { ok: false, code: 'MEAL_ALREADY_COMPLETED', message: 'La comida ya fue completada.' } as const;
  }

  return { ok: true, data: { plan, meal } } as const;
}

export function markPlanMealCompleted(meal: Plan['meals'][number]) {
  meal.completedAt = new Date().toISOString();
  return meal;
}

export function selectPlan(userId: string, planId: string) {
  const plan = (plansByUserId.get(userId) ?? []).find((entry) => entry.id === planId);
  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  if (plan.status !== 'candidate') {
    return { ok: false, code: 'PLAN_NOT_SELECTABLE', message: 'El plan ya no está disponible para selección.' } as const;
  }

  for (const candidate of listPlanGeneration(userId, plan.generationId)) {
    candidate.status = candidate.id === plan.id ? 'selected' : 'discarded';
  }

  return { ok: true, data: plan } as const;
}

export function createShoppingList(userId: string, planId: string) {
  const plan = (plansByUserId.get(userId) ?? []).find((entry) => entry.id === planId);

  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  if (plan.status !== 'selected') {
    return { ok: false, code: 'PLAN_NOT_SELECTED', message: 'Debes seleccionar el plan antes de generar la lista de compras.' } as const;
  }

  const itemsByKey = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const meal of plan.meals) {
    for (const ingredient of meal.ingredients) {
      const key = `${ingredient.name.toLowerCase()}::${ingredient.unit.toLowerCase()}`;
      const current = itemsByKey.get(key);
      if (current) {
        current.quantity += ingredient.quantity * meal.servings;
      } else {
        itemsByKey.set(key, {
          name: ingredient.name,
          quantity: ingredient.quantity * meal.servings,
          unit: ingredient.unit
        });
      }
    }
  }

  const items = [...itemsByKey.values()];

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
