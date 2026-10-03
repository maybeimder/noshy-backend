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
