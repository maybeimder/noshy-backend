import type { Request, Response } from 'express';
import { runHandler } from '../../../infrastructure/http/command-dispatch';
import { PlanHandlers } from '../events/plan.handlers';
import type { createNutritionPlan, getActiveNutritionPlan, listNutritionPlans, updateActiveNutritionPlan } from '../plan.service';

export class PlanController {
  static createNutrition = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof createNutritionPlan>>(request, response, PlanHandlers.create, { data: request.body });
    if (!outcome) return;
    response.status(201).json(outcome.result);
  };

  static listNutrition = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof listNutritionPlans>>(request, response, PlanHandlers.list);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static activeNutrition = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof getActiveNutritionPlan>>(request, response, PlanHandlers.active);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static updateNutrition = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof updateActiveNutritionPlan>>(request, response, PlanHandlers.updateActive, {
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
}