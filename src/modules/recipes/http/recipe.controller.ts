import type { Request, Response } from 'express';
import { createRecipe, listRecipes } from '../recipe.service';
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
}
