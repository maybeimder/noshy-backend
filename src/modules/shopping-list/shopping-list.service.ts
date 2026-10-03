import { listInventoryItems } from '../inventory/inventory.service';
import { listRecipes } from '../recipes/recipe.service';
import type { ShoppingListInput } from './shopping-list.model';

const normalize = (value: string) => value.trim().toLowerCase();

export function createShoppingList(userId: string, input: ShoppingListInput) {
  const requiredByKey = new Map<string, { name: string; unit: string; quantity: number }>();
  const recipes: { recipeId?: string; title: string; servings: number }[] = [];

  for (const requestedRecipe of input.recipes) {
    const recipe = requestedRecipe.recipeId
      ? listRecipes(userId).find((entry) => entry.id === requestedRecipe.recipeId)
      : undefined;

    if (requestedRecipe.recipeId && !recipe) {
      return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe una de las recetas solicitadas.' } as const;
    }

    const ingredients = recipe?.ingredients ?? requestedRecipe.ingredients ?? [];
    recipes.push({
      recipeId: recipe?.id,
      title: recipe?.title ?? requestedRecipe.title ?? 'Receta generada',
      servings: requestedRecipe.servings
    });

    for (const ingredient of ingredients) {
      const key = `${normalize(ingredient.name)}::${normalize(ingredient.unit)}`;
      const current = requiredByKey.get(key);
      const quantity = ingredient.quantity * requestedRecipe.servings;
      if (current) {
        current.quantity += quantity;
      } else {
        requiredByKey.set(key, { name: ingredient.name, unit: ingredient.unit, quantity });
      }
    }
  }

  const availableByKey = new Map<string, number>();
  for (const item of listInventoryItems(userId)) {
    const key = `${normalize(item.name)}::${normalize(item.unit)}`;
    availableByKey.set(key, (availableByKey.get(key) ?? 0) + item.quantity);
  }

  const items = [...requiredByKey.entries()].map(([key, required]) => {
    const availableQuantity = availableByKey.get(key) ?? 0;
    return {
      name: required.name,
      quantity: required.quantity,
      unit: required.unit,
      availableQuantity,
      missingQuantity: Math.max(required.quantity - availableQuantity, 0)
    };
  });

  return {
    ok: true,
    data: {
      recipes,
      items,
      availableItems: items
        .filter((item) => item.missingQuantity === 0)
        .map(({ name, quantity, unit }) => ({ name, quantity, unit })),
      missingItems: items
        .filter((item) => item.missingQuantity > 0)
        .map((item) => ({ name: item.name, quantity: item.missingQuantity, unit: item.unit }))
    }
  } as const;
}
