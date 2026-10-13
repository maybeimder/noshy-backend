import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { FoodController } from './food.controller';

const foodRouter = Router();
foodRouter.use(requireAuth);
// Catálogo de alimentos (products_slim)
foodRouter.get('/products', FoodController.searchProducts);
foodRouter.get('/products/:id', FoodController.getProduct);
foodRouter.post('/macros', FoodController.calculateMacros);
// Biblioteca de recetas de referencia (recipes_raw)
foodRouter.get('/library/recipes', FoodController.searchLibrary);
foodRouter.get('/library/recipes/:id', FoodController.getLibraryRecipe);
// Recetas generadas con IA (RAG) e historial
foodRouter.post('/recipes/generate', FoodController.generateRecipe);
foodRouter.get('/recipes/:id', FoodController.getGeneratedRecipe);
foodRouter.get('/history', FoodController.history);

export default foodRouter;
