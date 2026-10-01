import type { Request, Response } from 'express';
import { addInventoryItem, listInventoryItems } from '../inventory.service';
import { inventoryItemSchema } from './inventory.dto';

export class InventoryController {
  static create = (request: Request, response: Response) => {
    const parsed = inventoryItemSchema.safeParse(request.body);

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

    const created = addInventoryItem(user.id, parsed.data);
    response.status(201).json(created);
  };

  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listInventoryItems(user.id));
  };
}
