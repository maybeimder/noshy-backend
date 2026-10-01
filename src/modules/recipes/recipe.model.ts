export type RecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
};

export type Recipe = {
  id: string;
  userId: string;
  authorName?: string;
  title: string;
  ingredients: RecipeIngredient[];
  instructions: string[];
  isPublic: boolean;
  createdAt: string;
};

export type RecipeInput = {
  title: string;
  ingredients: RecipeIngredient[];
  instructions: string[];
};
