import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { ChefSessionController } from './chef-session.controller';

const chefSessionRouter = Router();
chefSessionRouter.use(requireAuth);
chefSessionRouter.post('/', ChefSessionController.open);
chefSessionRouter.post('/:id/messages', ChefSessionController.addMessage);
chefSessionRouter.get('/:id/context', ChefSessionController.context);
chefSessionRouter.post('/:id/close', ChefSessionController.close);

export default chefSessionRouter;
