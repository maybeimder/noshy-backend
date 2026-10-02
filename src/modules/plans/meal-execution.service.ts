import { consumeInventory } from '../inventory/inventory.service';
import { completePlanMeal, markPlanMealCompleted } from './plan.service';

export function executePlanMeal(userId: string, planId: string, mealId: string) {
  const mealResult = completePlanMeal(userId, planId, mealId);
  if (!mealResult.ok) {
    return mealResult;
  }

  const requirements = mealResult.data.meal.ingredients.map((ingredient) => ({
    name: ingredient.name,
    quantity: ingredient.quantity * mealResult.data.meal.servings,
    unit: ingredient.unit
  }));
  const consumption = consumeInventory(userId, requirements);
  if (!consumption.ok) {
    return consumption;
  }

  return {
    ok: true,
    data: {
      meal: markPlanMealCompleted(mealResult.data.meal),
      consumedInventory: consumption.consumedInventory
    }
  } as const;
}