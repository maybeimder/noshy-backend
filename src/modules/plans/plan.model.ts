export type PlanMeal = {
  id: string;
  day: number;
  type: 'breakfast' | 'lunch' | 'dinner';
  title: string;
  recipeId: string;
  ingredients: ShoppingItem[];
  servings: number;
  completedAt?: string;
};

export type PlanStatus = 'candidate' | 'selected' | 'discarded';

export type NutritionPlanObjective = 'lose_weight' | 'gain_weight' | 'burn_fat' | 'gain_muscle' | 'maintain' | 'custom';

export type NutritionPlanTargets = {
  calories?: number;
  carbohydratesGrams?: number;
  proteinGrams?: number;
  fatGrams?: number;
};

export type NutritionPlan = {
  id: string;
  userId: string;
  objective: NutritionPlanObjective;
  targets: NutritionPlanTargets;
  restrictions: string[];
  mealsPerDay?: number;
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlanInput = {
  objective: NutritionPlanObjective;
  targets: NutritionPlanTargets;
  restrictions?: string[];
  mealsPerDay?: number;
};

export type Plan = {
  id: string;
  userId: string;
  generationId: string;
  status: PlanStatus;
  days: number;
  mealsPerDay: number;
  goals: string[];
  meals: PlanMeal[];
  createdAt: string;
};

export type PlanInput = {
  days: number;
  goals: string[];
  mealsPerDay: number;
  recipeIds: string[];
};

export type PlanGeneration = {
  generationId: string;
  plans: Plan[];
};

export type ShoppingItem = {
  name: string;
  quantity: number;
  unit: string;
};

export type ShoppingList = {
  id: string;
  userId: string;
  planId: string;
  items: ShoppingItem[];
  createdAt: string;
};
