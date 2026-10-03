import type { Request, Response } from 'express';
import { createNutritionPlan, getActiveNutritionPlan, listNutritionPlans, updateActiveNutritionPlan } from '../plan.service';
import { nutritionPlanInputSchema } from './plan.dto';

type AuthenticatedRequest = Request & { user?: { id: string; name: string; email: string } };

export class PlanController {
  static createNutrition = (request: AuthenticatedRequest, response: Response) => {
    const parsed = nutritionPlanInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }
    response.status(201).json(createNutritionPlan(request.user.id, parsed.data));
  };

  static listNutrition = (request: AuthenticatedRequest, response: Response) => {
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }
    response.status(200).json(listNutritionPlans(request.user.id));
  };

  static activeNutrition = (request: AuthenticatedRequest, response: Response) => {
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }
    response.status(200).json(getActiveNutritionPlan(request.user.id));
  };

  static updateNutrition = (request: AuthenticatedRequest, response: Response) => {
    const parsed = nutritionPlanInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }
    const result = updateActiveNutritionPlan(request.user.id, parsed.data);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(200).json(result.data);
  };
}
