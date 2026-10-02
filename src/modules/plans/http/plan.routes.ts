import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { PlanController, ShoppingListController } from './plan.controller';

const planRouter = Router();
const shoppingListRouter = Router();

planRouter.use(requireAuth);
shoppingListRouter.use(requireAuth);

planRouter.post('/generate', PlanController.generate);
planRouter.get('/', PlanController.list);
planRouter.get('/generations/:generationId', PlanController.listGeneration);
planRouter.get('/:planId/inventory-coverage', PlanController.inventoryCoverage);
planRouter.post('/:planId/meals/:mealId/complete', PlanController.completeMeal);
planRouter.post('/:id/select', PlanController.select);
planRouter.post('/shopping-list', ShoppingListController.create);
shoppingListRouter.post('/', ShoppingListController.create);

export default Object.assign(planRouter, { shoppingListRouter });
