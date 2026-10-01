export type RecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
};

export type Recipe = {
  id: string;
  userId: string;
  title: string;
  ingredients: RecipeIngredient[];
  instructions: string[];
  createdAt: string;
};

export type RecipeInput = {
  title: string;
  ingredients: RecipeIngredient[];
  instructions: string[];
};
