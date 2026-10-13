// Catálogo central de eventos: un solo punto para ver todo lo que el sistema puede registrar.
import type { EventType } from '../../core/events/domain-event';
import { ChefMessageRecordedEvent, ChefSessionClosedEvent, ChefSessionOpenedEvent, ChefSessionRecoveryRequiredEvent } from '../../modules/chef-sessions/events/chef-session.events';
import { FeedbackRecordedEvent } from '../../modules/feedback/events/feedback.events';
import { FoodMealLoggedEvent, FoodRecipeGeneratedEvent } from '../../modules/food/events/food.events';
import { InventoryItemAddedEvent, InventoryItemRemovedEvent, InventoryItemUpdatedEvent } from '../../modules/inventory/events/inventory.events';
import { NutritionPlanCreatedEvent, NutritionPlanUpdatedEvent } from '../../modules/plans/events/plan.events';
import { RecipeCreatedEvent, RecipeDeletedEvent, RecipePublishedEvent, RecipeUnpublishedEvent, RecipeUpdatedEvent } from '../../modules/recipes/events/recipe.events';
import { ShoppingListGeneratedEvent } from '../../modules/shopping-list/events/shopping-list.events';
import { UserLoggedInEvent, UserRegisteredEvent } from '../../modules/auth/events/auth.events';

// Todo evento nuevo debe agregarse aquí: el DomainEventFactory lo necesita para rehidratar desde el store.
export const domainEventTypes: EventType[] = [
  UserRegisteredEvent,
  UserLoggedInEvent,
  NutritionPlanCreatedEvent,
  NutritionPlanUpdatedEvent,
  InventoryItemAddedEvent,
  InventoryItemUpdatedEvent,
  InventoryItemRemovedEvent,
  RecipeCreatedEvent,
  RecipeUpdatedEvent,
  RecipeDeletedEvent,
  RecipePublishedEvent,
  RecipeUnpublishedEvent,
  ChefSessionOpenedEvent,
  ChefMessageRecordedEvent,
  ChefSessionClosedEvent,
  ChefSessionRecoveryRequiredEvent,
  FeedbackRecordedEvent,
  ShoppingListGeneratedEvent,
  FoodRecipeGeneratedEvent,
  FoodMealLoggedEvent
];
