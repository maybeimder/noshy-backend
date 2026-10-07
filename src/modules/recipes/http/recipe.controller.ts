import type { Request, Response } from 'express';
import { routeParam, runHandler } from '../../../infrastructure/http/command-dispatch';
import { RecipeHandlers } from '../events/recipe.handlers';
import type { adaptRecipe } from '../recipe-adaptation.service';
import type {
  createRecipe,
  deleteRecipe,
  getCommunityRecipe,
  listCommunityRecipes,
  listRecipes,
  publishRecipe,
  unpublishRecipe,
  updateRecipe
} from '../recipe.service';

type UserRequest = Request & { user?: { id: string; name: string; email: string } };

export class RecipeController {
  static create = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof createRecipe>>(request, response, RecipeHandlers.create, { data: request.body });
    if (!outcome) return;
    response.status(201).json(outcome.result);
  };

  static list = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof listRecipes>>(request, response, RecipeHandlers.list);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static update = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof updateRecipe>>(request, response, RecipeHandlers.update, {
      params: { recipeId: routeParam(request) },
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(200).json(result.data);
  };

  static delete = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof deleteRecipe>>(request, response, RecipeHandlers.delete, {
      params: { recipeId: routeParam(request) }
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(204).send();
  };

  static publish = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof publishRecipe>>(request, response, RecipeHandlers.publish, {
      params: { recipeId: routeParam(request), authorName: (request as UserRequest).user?.name }
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static unpublish = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof unpublishRecipe>>(request, response, RecipeHandlers.unpublish, {
      params: { recipeId: routeParam(request) }
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static communityList = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof listCommunityRecipes>>(request, response, RecipeHandlers.communityList);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static communityDetail = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof getCommunityRecipe>>(request, response, RecipeHandlers.communityDetail, {
      params: { recipeId: routeParam(request) }
    });
    if (!outcome) return;
    if (!outcome.result) {
      response.status(404).json({ code: 'RECIPE_NOT_FOUND', message: 'No existe la receta pública solicitada.' });
      return;
    }
    response.status(200).json(outcome.result);
  };

  static adapt = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof adaptRecipe>>(request, response, RecipeHandlers.adapt, { data: request.body });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}