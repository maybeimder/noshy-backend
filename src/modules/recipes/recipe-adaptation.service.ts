import { listInventoryItems } from '../inventory/inventory.service';
import { listRecipes } from './recipe.service';

const normalize = (value: string) => value.trim().toLowerCase();

export async function adaptRecipe(userId: string, recipeId: string) {
  const recipe = (await listRecipes(userId)).find((entry) => entry.id === recipeId);
  if (!recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  const availableByKey = new Map<string, number>();
  for (const item of await listInventoryItems(userId)) {
    const key = `${normalize(item.name)}::${normalize(item.unit)}`;
    availableByKey.set(key, (availableByKey.get(key) ?? 0) + item.quantity);
  }

  const ingredients = recipe.ingredients.filter((ingredient) =>
    (availableByKey.get(`${normalize(ingredient.name)}::${normalize(ingredient.unit)}`) ?? 0) >= ingredient.quantity
  );
  const missingIngredients = recipe.ingredients
    .map((ingredient) => {
      const availableQuantity = availableByKey.get(`${normalize(ingredient.name)}::${normalize(ingredient.unit)}`) ?? 0;
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
      recipeId,
      title: `${recipe.title} adaptada`,
      ingredients,
      missingIngredients,
      instructions: recipe.instructions
    }
  } as const;
}
