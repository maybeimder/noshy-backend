// Arma app de Express aca
import express from 'express';
import cors from 'cors';
import authRouter from '../../modules/auth/http/auth.routes';
import inventoryRouter from '../../modules/inventory/http/inventory.routes';
import planRouter from '../../modules/plans/http/plan.routes';
import recipeRouter from '../../modules/recipes/http/recipe.routes';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/inventory', inventoryRouter);
  app.use('/recipes', recipeRouter);
  app.use('/plans', planRouter);
  app.use('/shopping-list', (planRouter as typeof planRouter & { shoppingListRouter?: typeof planRouter }).shoppingListRouter ?? planRouter);

  return app;
}
