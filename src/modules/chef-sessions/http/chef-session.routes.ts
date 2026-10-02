import { Router } from 'express';
import type { ChefAgentPort } from '../chef-agent.port';
import { requireAuth } from '../../auth/http/auth.middleware';
import { ChefSessionController } from './chef-session.controller';

export function createChefSessionRouter(agent: ChefAgentPort) {
	const chefSessionRouter = Router();
	chefSessionRouter.use(requireAuth);
	chefSessionRouter.post('/', ChefSessionController.open);
	chefSessionRouter.post('/:id/messages', ChefSessionController.addMessage);
	chefSessionRouter.post('/:id/respond', (request, response) => ChefSessionController.respond(request, response, agent));
	chefSessionRouter.get('/:id/context', ChefSessionController.context);
	chefSessionRouter.post('/:id/close', ChefSessionController.close);
	return chefSessionRouter;
}
