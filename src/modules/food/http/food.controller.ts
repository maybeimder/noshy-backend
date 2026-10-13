import type { Request, Response } from 'express';
import { routeParam, runHandler } from '../../../infrastructure/http/command-dispatch';
import { FoodHandlers } from '../events/food.handlers';
import type {
  calculateMacros,
  generateRecipe,
  getFood,
  getFoodHistory,
  getGeneratedRecipe,
  getLibraryRecipe,
  searchFoods,
  searchLibraryRecipes
} from '../food.service';

type FoodFailure = { ok: false; code: string; message: string };

const STATUS_BY_CODE: Record<string, number> = {
  FOOD_NOT_FOUND: 404,
  LIBRARY_RECIPE_NOT_FOUND: 404,
  GENERATED_RECIPE_NOT_FOUND: 404,
  SERVING_NOT_FOUND: 422,
  FOOD_CATALOG_UNAVAILABLE: 503,
  RECIPE_WRITER_UNAVAILABLE: 503
};

function sendFailure(response: Response, failure: FoodFailure) {
  response.status(STATUS_BY_CODE[failure.code] ?? 409).json({ code: failure.code, message: failure.message });
}

// En los GET el DTO se valida contra la query string (?q=..., ?ingredients=...).
async function respond<T extends { ok: true; data: unknown } | FoodFailure>(
  request: Request,
  response: Response,
  handler: string,
  input: { params?: Record<string, string | undefined>; data?: unknown },
  status = 200
) {
  const outcome = await runHandler<T>(request, response, handler, input);
  if (!outcome) return;
  if (!outcome.result.ok) {
    sendFailure(response, outcome.result);
    return;
  }
  response.status(status).json(outcome.result.data);
}

export class FoodController {
  static searchProducts = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof searchFoods>>>(request, response, FoodHandlers.searchProducts, { data: request.query });

  static getProduct = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof getFood>>>(request, response, FoodHandlers.getProduct, { params: { foodId: routeParam(request) } });

  static calculateMacros = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof calculateMacros>>>(request, response, FoodHandlers.calculateMacros, { data: request.body });

  static searchLibrary = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof searchLibraryRecipes>>>(request, response, FoodHandlers.searchLibrary, { data: request.query });

  static getLibraryRecipe = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof getLibraryRecipe>>>(request, response, FoodHandlers.getLibraryRecipe, {
      params: { recipeId: routeParam(request) }
    });

  static generateRecipe = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof generateRecipe>>>(request, response, FoodHandlers.generateRecipe, { data: request.body }, 201);

  static history = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof getFoodHistory>>>(request, response, FoodHandlers.history, {
      data: request.query
    });
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static getGeneratedRecipe = (request: Request, response: Response) =>
    respond<Awaited<ReturnType<typeof getGeneratedRecipe>>>(request, response, FoodHandlers.getGeneratedRecipe, {
      params: { recipeId: routeParam(request) }
    });
}
