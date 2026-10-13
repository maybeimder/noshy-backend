// Entrada única (HTTP y RabbitMQ) del módulo de alimentos: catálogo, macros, biblioteca de recetas y RAG.
import { defineHandler } from '../../../core/commands/command-bus';
import {
  browseLibraryRecipes,
  calculateMacros,
  generateRecipe,
  getFood,
  getFoodHistory,
  getGeneratedRecipe,
  getLibraryRecipe,
  searchFoods,
  searchLibraryRecipes,
  type FoodDependencies
} from '../food.service';
import {
  foodHistorySchema,
  foodSearchSchema,
  libraryBrowseSchema,
  librarySearchSchema,
  macroCalculationSchema,
  recipeGenerationSchema
} from '../http/food.dto';

export const FoodHandlers = {
  searchProducts: 'food.search_products',
  getProduct: 'food.get_product',
  calculateMacros: 'food.calculate_macros',
  searchLibrary: 'food.search_library',
  browseLibrary: 'food.browse_library',
  getLibraryRecipe: 'food.get_library_recipe',
  generateRecipe: 'food.generate_recipe',
  history: 'food.history',
  getGeneratedRecipe: 'food.get_generated_recipe'
} as const;

// El catálogo (Mongo) y el redactor (OpenRouter) se inyectan al armar el CommandBus.
export function createFoodHandlers(deps: FoodDependencies) {
  return [
    defineHandler({ name: FoodHandlers.searchProducts, schema: foodSearchSchema, execute: ({ data }) => searchFoods(deps.catalog, data) }),
    defineHandler({ name: FoodHandlers.getProduct, params: ['foodId'], execute: ({ params }) => getFood(deps.catalog, params.foodId!) }),
    defineHandler({
      name: FoodHandlers.calculateMacros,
      schema: macroCalculationSchema,
      execute: ({ userId, data }) => calculateMacros(userId, deps.catalog, data)
    }),
    defineHandler({ name: FoodHandlers.searchLibrary, schema: librarySearchSchema, execute: ({ data }) => searchLibraryRecipes(deps, data) }),
    defineHandler({ name: FoodHandlers.browseLibrary, schema: libraryBrowseSchema, execute: ({ data }) => browseLibraryRecipes(deps.catalog, data) }),
    defineHandler({
      name: FoodHandlers.getLibraryRecipe,
      params: ['recipeId'],
      execute: ({ params }) => getLibraryRecipe(deps.catalog, params.recipeId!)
    }),
    defineHandler({
      name: FoodHandlers.generateRecipe,
      schema: recipeGenerationSchema,
      execute: ({ userId, data }) => generateRecipe(userId, deps, data)
    }),
    defineHandler({ name: FoodHandlers.history, schema: foodHistorySchema, execute: ({ userId, data }) => getFoodHistory(userId, data.limit) }),
    defineHandler({
      name: FoodHandlers.getGeneratedRecipe,
      params: ['recipeId'],
      execute: ({ userId, params }) => getGeneratedRecipe(userId, params.recipeId!)
    })
  ];
}
