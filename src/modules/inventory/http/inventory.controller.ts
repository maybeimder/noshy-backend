import type { Request, Response } from 'express';
import { addInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from '../inventory.service';
import { inventoryItemSchema, inventoryItemUpdateSchema } from './inventory.dto';

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

  static update = (request: Request, response: Response) => {
    const parsed = inventoryItemUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const itemId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = updateInventoryItem(user.id, itemId, parsed.data);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(200).json(result.data);
  };

  static delete = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const itemId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = deleteInventoryItem(user.id, itemId);
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(204).send();
  };
}
