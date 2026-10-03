import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { PlanController } from './plan.controller';

const planRouter = Router();

planRouter.use(requireAuth);

planRouter.post('/', PlanController.createNutrition);
planRouter.get('/active', PlanController.activeNutrition);
planRouter.put('/active', PlanController.updateNutrition);
planRouter.get('/nutrition', PlanController.listNutrition);
planRouter.get('/', PlanController.listNutrition);

export default planRouter;
