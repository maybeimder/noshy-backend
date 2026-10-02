import { getPlanInventoryCoverage } from '../inventory/inventory.service';
import { getPlanById } from '../plans/plan.service';
import { listRecipes } from './recipe.service';

export function adaptRecipe(userId: string, planId: string, recipeId: string) {
  const plan = getPlanById(userId, planId);
  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  if (plan.status !== 'selected') {
    return { ok: false, code: 'PLAN_NOT_SELECTED', message: 'Debes seleccionar el plan antes de adaptar una receta.' } as const;
  }

  const recipe = listRecipes(userId).find((entry) => entry.id === recipeId);
  const recipeIsInPlan = plan.meals.some((meal) => meal.recipeId === recipeId);
  if (!recipe || !recipeIsInPlan) {
    return { ok: false, code: 'RECIPE_NOT_IN_PLAN', message: 'La receta no pertenece al plan seleccionado.' } as const;
  }

  const coverage = getPlanInventoryCoverage(userId, planId);
  if (!coverage.ok) {
    return coverage;
  }

  const coverageByKey = new Map(
    coverage.data.items.map((item) => [`${item.name.toLowerCase()}::${item.unit.toLowerCase()}`, item])
  );
  const ingredients = recipe.ingredients.filter((ingredient) => {
    const item = coverageByKey.get(`${ingredient.name.toLowerCase()}::${ingredient.unit.toLowerCase()}`);
    return item?.covered === true;
  });
  const missingIngredients = recipe.ingredients
    .map((ingredient) => {
      const item = coverageByKey.get(`${ingredient.name.toLowerCase()}::${ingredient.unit.toLowerCase()}`);
      const availableQuantity = item?.availableQuantity ?? 0;
      return {
        name: ingredient.name,
        quantity: Math.max(ingredient.quantity - availableQuantity, 0),
        unit: ingredient.unit
      };
    })
    .filter((ingredient) => ingredient.quantity > 0);

  return {
    ok: true,
    data: {
      planId,
      recipeId,
      title: `${recipe.title} adaptada`,
      ingredients,
      missingIngredients,
      instructions: recipe.instructions
    }
  } as const;
}
