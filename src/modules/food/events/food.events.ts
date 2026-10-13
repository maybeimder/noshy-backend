import { DomainEvent } from '../../../core/events/domain-event';
import type { GeneratedRecipe, MacroSummary } from '../food.model';

// Las búsquedas en el catálogo son lecturas y no generan eventos. Sí los generan los resultados que el
// usuario se queda: recetas generadas y comidas registradas. Con ellos se reconstruye su historial
// (Event Sourcing, ver food-history.projection.ts).

export class FoodRecipeGeneratedEvent extends DomainEvent<{
  userId: string;
  recipe: GeneratedRecipe;
  requestedIngredients: { name: string; grams?: number; foodId?: string }[];
  // Ids de recipes_raw usados como contexto (RAG).
  referenceRecipeIds: number[];
}> {
  static readonly eventName = 'food.recipe_generated';
}

export class FoodMealLoggedEvent extends DomainEvent<{
  userId: string;
  mealId: string;
  label?: string;
  items: { foodId: string; name: string; grams: number }[];
  totals: MacroSummary['totals'];
}> {
  static readonly eventName = 'food.meal_logged';
}
