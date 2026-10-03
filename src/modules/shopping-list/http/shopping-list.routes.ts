import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { ShoppingListController } from './shopping-list.controller';

const shoppingListRouter = Router();
shoppingListRouter.use(requireAuth);
shoppingListRouter.post('/', ShoppingListController.create);

export default shoppingListRouter;
