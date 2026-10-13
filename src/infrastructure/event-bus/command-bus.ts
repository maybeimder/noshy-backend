import { CommandBus, type ProcessedMessageStore } from '../../core/commands/command-bus';
import { authHandlers } from '../../modules/auth/events/auth.handlers';
import { createUnavailableChefAgent, type ChefAgentPort } from '../../modules/chef-sessions/chef-agent.port';
import { createChefSessionHandlers } from '../../modules/chef-sessions/events/chef-session.handlers';
import { feedbackHandlers } from '../../modules/feedback/events/feedback.handlers';
import { createFoodHandlers } from '../../modules/food/events/food.handlers';
import { createUnavailableFoodCatalog, type FoodCatalogPort } from '../../modules/food/food-catalog.port';
import { createUnavailableRecipeWriter, type RecipeWriterPort } from '../../modules/food/recipe-writer.port';
import { inventoryHandlers } from '../../modules/inventory/events/inventory.handlers';
import { planHandlers } from '../../modules/plans/events/plan.handlers';
import { recipeHandlers } from '../../modules/recipes/events/recipe.handlers';
import { shoppingListHandlers } from '../../modules/shopping-list/events/shopping-list.handlers';

export type CommandBusOptions = {
  chefAgent?: ChefAgentPort;
  // Catálogo de alimentos (Mongo) y redactor de recetas (OpenRouter). Sin ellos, /food responde 503.
  foodCatalog?: FoodCatalogPort;
  recipeWriter?: RecipeWriterPort;
  processedMessages?: ProcessedMessageStore;
};

// Arma el CommandBus con los handlers de todos los módulos. Lo usan createServer() (HTTP)
// y el consumer de RabbitMQ, así ambos disparan exactamente las mismas funciones.
// processedMessages: con Postgres, la idempotencia de mensajes sobrevive reinicios y es compartida.
export function createCommandBus(options: CommandBusOptions = {}): CommandBus {
  return new CommandBus({ processedMessages: options.processedMessages }).register(
    ...authHandlers,
    ...planHandlers,
    ...inventoryHandlers,
    ...recipeHandlers,
    ...feedbackHandlers,
    ...shoppingListHandlers,
    ...createChefSessionHandlers(options.chefAgent ?? createUnavailableChefAgent()),
    ...createFoodHandlers({
      catalog: options.foodCatalog ?? createUnavailableFoodCatalog(),
      writer: options.recipeWriter ?? createUnavailableRecipeWriter()
    })
  );
}
