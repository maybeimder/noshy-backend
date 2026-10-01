export type PlanMeal = {
  id: string;
  day: number;
  type: 'breakfast' | 'lunch' | 'dinner';
  title: string;
};

export type Plan = {
  id: string;
  userId: string;
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
