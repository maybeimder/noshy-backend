import type { Request, Response } from 'express';
import { adaptRecipe } from '../recipe-adaptation.service';
import { createRecipe, listCommunityRecipes, listRecipes, publishRecipe } from '../recipe.service';
import { recipeAdaptationSchema } from './recipe-adaptation.dto';
import { recipeSchema } from './recipe.dto';

export class RecipeController {
  static create = (request: Request, response: Response) => {
    const parsed = recipeSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        message: 'Datos inválidos.',
        issues: parsed.error.issues
      });
      return;
    }

    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const created = createRecipe(user.id, parsed.data);
    response.status(201).json(created);
  };

  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listRecipes(user.id));
  };

  static publish = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const recipeId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = publishRecipe(user.id, recipeId, user.name);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static communityList = (_request: Request, response: Response) => {
    response.status(200).json(listCommunityRecipes());
  };

  static adapt = (request: Request, response: Response) => {
    const parsed = recipeAdaptationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const result = adaptRecipe(user.id, parsed.data.recipeId);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}
