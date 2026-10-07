import { DomainEvent } from '../../../core/events/domain-event';
import type { Recipe } from '../recipe.model';

export class RecipeCreatedEvent extends DomainEvent<{ userId: string; recipe: Recipe }> {
  static readonly eventName = 'recipes.recipe_created';
}

export class RecipeUpdatedEvent extends DomainEvent<{ userId: string; recipe: Recipe }> {
  static readonly eventName = 'recipes.recipe_updated';
}

export class RecipeDeletedEvent extends DomainEvent<{ userId: string; recipeId: string }> {
  static readonly eventName = 'recipes.recipe_deleted';
}

export class RecipePublishedEvent extends DomainEvent<{ userId: string; recipe: Recipe }> {
  static readonly eventName = 'recipes.recipe_published';
}

export class RecipeUnpublishedEvent extends DomainEvent<{ userId: string; recipeId: string }> {
  static readonly eventName = 'recipes.recipe_unpublished';
}