import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { ChefSessionController } from './chef-session.controller';

// El agente ya no viaja por el router: lo tiene el handler chef.respond dentro del CommandBus.
export function createChefSessionRouter() {
	const chefSessionRouter = Router();
	chefSessionRouter.use(requireAuth);
	chefSessionRouter.post('/', ChefSessionController.open);
	chefSessionRouter.post('/:id/messages', ChefSessionController.addMessage);
	chefSessionRouter.post('/:id/respond', ChefSessionController.respond);
	chefSessionRouter.get('/:id/context', ChefSessionController.context);
	chefSessionRouter.post('/:id/close', ChefSessionController.close);
	return chefSessionRouter;
}
