export type ShoppingListRecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
};

export type ShoppingListRecipeInput = {
  recipeId?: string;
  title?: string;
  servings: number;
  ingredients?: ShoppingListRecipeIngredient[];
};

export type ShoppingListInput = {
  recipes: ShoppingListRecipeInput[];
};
