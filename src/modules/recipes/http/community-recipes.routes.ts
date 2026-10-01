import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { RecipeController } from './recipe.controller';

const communityRecipesRouter = Router();
communityRecipesRouter.use(requireAuth);
communityRecipesRouter.get('/recipes', RecipeController.communityList);

export default communityRecipesRouter;
