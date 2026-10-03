import { Router } from 'express';
import { RecipeController } from './recipe.controller';

const communityRecipesRouter = Router();
communityRecipesRouter.get('/recipes', RecipeController.communityList);
communityRecipesRouter.get('/recipes/:id', RecipeController.communityDetail);

export default communityRecipesRouter;
