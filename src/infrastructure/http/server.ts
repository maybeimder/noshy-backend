// Arma app de Express aca
import express from 'express';
import cors from 'cors';
import type { CommandBus } from '../../core/commands/command-bus';
import { getEnv } from '../config/env';
import { createCommandBus, type CommandBusOptions } from '../event-bus/command-bus';
import authRouter from '../../modules/auth/http/auth.routes';
import { createChefSessionRouter } from '../../modules/chef-sessions/http/chef-session.routes';
import { feedbackRouter, recommendationsRouter } from '../../modules/feedback/http/feedback.routes';
import foodRouter from '../../modules/food/http/food.routes';
import inventoryRouter from '../../modules/inventory/http/inventory.routes';
import planRouter from '../../modules/plans/http/plan.routes';
import communityRecipesRouter from '../../modules/recipes/http/community-recipes.routes';
import recipeRouter from '../../modules/recipes/http/recipe.routes';
import shoppingListRouter from '../../modules/shopping-list/http/shopping-list.routes';
import { errorMiddleware, notFoundMiddleware } from './middlewares/error.middleware';

// commandBus: pásalo para compartir el mismo bus con el consumer de RabbitMQ (ver entrypoints/api.ts).
export function createServer(options: Pick<CommandBusOptions, 'chefAgent' | 'foodCatalog' | 'recipeWriter'> & { commandBus?: CommandBus } = {}) {
  const environment = getEnv();
  const app = express();
  // Los controllers no llaman servicios: despachan a este bus (ver http/command-dispatch.ts).
  const { commandBus, ...dependencies } = options;
  app.set('commandBus', commandBus ?? createCommandBus(dependencies));
  app.use(cors({ origin: environment.corsOrigin }));
  app.use(express.json({ limit: environment.jsonBodyLimit }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/chef/sessions', createChefSessionRouter());
  app.use('/feedback', feedbackRouter);
  app.use('/food', foodRouter);
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
