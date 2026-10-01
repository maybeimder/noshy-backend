import type { Request, Response } from 'express';
import { createShoppingList, generatePlan, listPlans } from '../plan.service';
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

    const plan = generatePlan(user.id, parsed.data);
    response.status(201).json(plan);
  };

  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listPlans(user.id));
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
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}
