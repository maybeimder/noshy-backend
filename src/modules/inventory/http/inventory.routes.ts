import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { InventoryController } from './inventory.controller';

const inventoryRouter = Router();
inventoryRouter.use(requireAuth);
inventoryRouter.post('/items', InventoryController.create);
inventoryRouter.get('/items', InventoryController.list);

export default inventoryRouter;
