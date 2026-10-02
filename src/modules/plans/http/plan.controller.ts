import type { Request, Response } from 'express';
import { getPlanInventoryCoverage } from '../../inventory/inventory.service';
import { executePlanMeal } from '../meal-execution.service';
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

  static inventoryCoverage = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const planId = Array.isArray(request.params.planId) ? request.params.planId[0] : request.params.planId;
    const result = getPlanInventoryCoverage(user.id, planId);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static completeMeal = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const planId = Array.isArray(request.params.planId) ? request.params.planId[0] : request.params.planId;
    const mealId = Array.isArray(request.params.mealId) ? request.params.mealId[0] : request.params.mealId;
    const result = executePlanMeal(user.id, planId, mealId);
    if (!result.ok) {
      const status = result.code === 'PLAN_NOT_FOUND' || result.code === 'MEAL_NOT_FOUND' ? 404 : 409;
      response.status(status).json({ code: result.code, message: 'message' in result ? result.message : 'No hay inventario suficiente.', ...('missingIngredients' in result ? { missingIngredients: result.missingIngredients } : {}) });
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
