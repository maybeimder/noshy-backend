// Arma app de Express aca
import express from 'express';
import cors from 'cors';
import type { CommandBus } from '../../core/commands/command-bus';
import { getEnv } from '../config/env';
import { createCommandBus } from '../event-bus/command-bus';
import authRouter from '../../modules/auth/http/auth.routes';
import type { ChefAgentPort } from '../../modules/chef-sessions/chef-agent.port';
import { createChefSessionRouter } from '../../modules/chef-sessions/http/chef-session.routes';
import { feedbackRouter, recommendationsRouter } from '../../modules/feedback/http/feedback.routes';
import inventoryRouter from '../../modules/inventory/http/inventory.routes';
import planRouter from '../../modules/plans/http/plan.routes';
import communityRecipesRouter from '../../modules/recipes/http/community-recipes.routes';
import recipeRouter from '../../modules/recipes/http/recipe.routes';
import shoppingListRouter from '../../modules/shopping-list/http/shopping-list.routes';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';

// commandBus: pásalo para compartir el mismo bus con el consumer de RabbitMQ (ver entrypoints/api.ts).
export function createServer(options: { chefAgent?: ChefAgentPort; commandBus?: CommandBus } = {}) {
  const environment = getEnv();
  const app = express();
  // Los controllers no llaman servicios: despachan a este bus (ver http/command-dispatch.ts).
  app.set('commandBus', options.commandBus ?? createCommandBus({ chefAgent: options.chefAgent }));
  app.use(cors({ origin: environment.corsOrigin }));
  app.use(express.json({ limit: environment.jsonBodyLimit }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/chef/sessions', createChefSessionRouter());
  app.use('/feedback', feedbackRouter);
  app.use('/recommendations', recommendationsRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/community', communityRecipesRouter);
  app.use('/recipes', recipeRouter);
  app.use('/plans', planRouter);
  app.use('/shopping-list', shoppingListRouter);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
