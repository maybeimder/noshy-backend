import type { Request, Response } from 'express';
import { createShoppingList } from '../shopping-list.service';
import { shoppingListInputSchema } from './shopping-list.dto';

type AuthenticatedRequest = Request & { user?: { id: string; name: string; email: string } };

export class ShoppingListController {
  static create = (request: AuthenticatedRequest, response: Response) => {
    const parsed = shoppingListInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const result = createShoppingList(request.user.id, parsed.data);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };
}
