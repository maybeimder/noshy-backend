import type { Request, Response } from 'express';
import { runHandler } from '../../../infrastructure/http/command-dispatch';
import { ShoppingListHandlers } from '../events/shopping-list.handlers';
import type { createShoppingList } from '../shopping-list.service';

export class ShoppingListController {
  static create = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof createShoppingList>>>(request, response, ShoppingListHandlers.generate, {
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}