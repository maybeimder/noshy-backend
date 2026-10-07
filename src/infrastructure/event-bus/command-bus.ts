import { CommandBus } from '../../core/commands/command-bus';
import { authHandlers } from '../../modules/auth/events/auth.handlers';
import { createUnavailableChefAgent, type ChefAgentPort } from '../../modules/chef-sessions/chef-agent.port';
import { createChefSessionHandlers } from '../../modules/chef-sessions/events/chef-session.handlers';
import { feedbackHandlers } from '../../modules/feedback/events/feedback.handlers';
import { inventoryHandlers } from '../../modules/inventory/events/inventory.handlers';
import { planHandlers } from '../../modules/plans/events/plan.handlers';
import { recipeHandlers } from '../../modules/recipes/events/recipe.handlers';
import { shoppingListHandlers } from '../../modules/shopping-list/events/shopping-list.handlers';

// Arma el CommandBus con los handlers de todos los módulos. Lo usan createServer() (HTTP)
// y el consumer de RabbitMQ, así ambos disparan exactamente las mismas funciones.
export function createCommandBus(options: { chefAgent?: ChefAgentPort } = {}): CommandBus {
  return new CommandBus().register(
    ...authHandlers,
    ...planHandlers,
    ...inventoryHandlers,
    ...recipeHandlers,
    ...feedbackHandlers,
    ...shoppingListHandlers,
    ...createChefSessionHandlers(options.chefAgent ?? createUnavailableChefAgent())
  );
}
