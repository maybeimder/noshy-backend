import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { RecipeController } from './recipe.controller';

const recipeRouter = Router();
recipeRouter.use(requireAuth);
recipeRouter.post('/', RecipeController.create);
recipeRouter.get('/', RecipeController.list);

export default recipeRouter;
