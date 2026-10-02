import type { Request, Response } from 'express';
import { listRecipes } from '../../recipes/recipe.service';
import { createShoppingList, generatePlanAlternatives, listPlanGeneration, listPlans, selectPlan } from '../plan.service';
import { planInputSchema, shoppingListInputSchema } from './plan.dto';

export class PlanController {
  static generate = (request: Request, response: Response) => {
    const parsed = planInputSchema.safeParse(request.body);

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

    const recipes = parsed.data.recipeIds.map((recipeId) =>
      listRecipes(user.id).find((recipe) => recipe.id === recipeId)
    ).filter((recipe): recipe is NonNullable<typeof recipe> => recipe !== undefined);

    if (recipes.length !== new Set(parsed.data.recipeIds).size) {
      response.status(404).json({ code: 'RECIPE_NOT_FOUND', message: 'Una o más recetas no existen.' });
      return;
    }

    const generation = generatePlanAlternatives(user.id, parsed.data, recipes);
    response.status(201).json(generation);
  };

  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listPlans(user.id));
  };

  static listGeneration = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const generationId = Array.isArray(request.params.generationId) ? request.params.generationId[0] : request.params.generationId;
    response.status(200).json({ generationId, plans: listPlanGeneration(user.id, generationId) });
  };

  static select = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const planId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = selectPlan(user.id, planId);
    if (!result.ok) {
      response.status(result.code === 'PLAN_NOT_FOUND' ? 404 : 409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };
}

export class ShoppingListController {
  static create = (request: Request, response: Response) => {
    const parsed = shoppingListInputSchema.safeParse(request.body);

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

    const result = createShoppingList(user.id, parsed.data.planId);

    if (!result.ok) {
      response.status(result.code === 'PLAN_NOT_FOUND' ? 404 : 409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}
