// Event Sourcing: el historial de comidas y recetas generadas no tiene tabla propia. Se reconstruye
// reproduciendo los eventos food.* del stream del usuario en el Event Store.
import type { StoredEvent } from '../../core/events/event-store';
import { FoodMealLoggedEvent, FoodRecipeGeneratedEvent } from './events/food.events';
import { inferRecipeTags } from './food-tags';
import type { GeneratedRecipe, Nutrients } from './food.model';

export type LoggedMeal = {
  mealId: string;
  label?: string;
  items: { foodId: string; name: string; grams: number }[];
  totals: Nutrients;
  loggedAt: string;
};

export type GeneratedRecipeEntry = {
  recipe: GeneratedRecipe;
  referenceRecipeIds: number[];
  generatedAt: string;
};

export class FoodHistoryProjection {
  private readonly meals: LoggedMeal[] = [];
  private readonly recipes = new Map<string, GeneratedRecipeEntry>();

  static fromEvents(events: StoredEvent[]): FoodHistoryProjection {
    const projection = new FoodHistoryProjection();
    for (const event of events) projection.apply(event);
    return projection;
  }

  apply(event: StoredEvent): void {
    if (event.type === FoodMealLoggedEvent.eventName) {
      const payload = event.payload as FoodMealLoggedEvent['payload'];
      this.meals.push({
        mealId: payload.mealId,
        ...(payload.label ? { label: payload.label } : {}),
        items: payload.items,
        totals: payload.totals,
        loggedAt: event.occurredAt
      });
    } else if (event.type === FoodRecipeGeneratedEvent.eventName) {
      const payload = event.payload as FoodRecipeGeneratedEvent['payload'];
      const { recipe } = payload;
      this.recipes.set(recipe.id, {
        // Los eventos anteriores a los tags no los traen: se deducen al reproducirlos (sin datos del catálogo).
        recipe: recipe.tags
          ? recipe
          : {
              ...recipe,
              tags: inferRecipeTags({
                title: recipe.title,
                ingredients: recipe.ingredients.map((ingredient) => ingredient.name),
                steps: recipe.steps.length,
                nutrientsPerServing: recipe.macros.perServing
              })
            },
        referenceRecipeIds: payload.referenceRecipeIds,
        generatedAt: event.occurredAt
      });
    }
  }

  // Más recientes primero.
  history(limit: number) {
    return {
      meals: [...this.meals].reverse().slice(0, limit),
      recipes: [...this.recipes.values()]
        .reverse()
        .slice(0, limit)
        .map(({ recipe, generatedAt }) => ({
          id: recipe.id,
          title: recipe.title,
          servings: recipe.servings,
          tags: recipe.tags,
          kcalTotal: recipe.macros.total.kcal ?? null,
          generatedAt
        }))
    };
  }

  generatedRecipe(id: string): GeneratedRecipeEntry | null {
    return this.recipes.get(id) ?? null;
  }
}
