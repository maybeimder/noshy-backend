import type { Request, Response } from 'express';
import { routeParam, runHandler } from '../../../infrastructure/http/command-dispatch';
import { InventoryHandlers } from '../events/inventory.handlers';
import type { addInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from '../inventory.service';

export class InventoryController {
  static create = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof addInventoryItem>>>(request, response, InventoryHandlers.add, { data: request.body });
    if (!outcome) return;
    response.status(201).json(outcome.result);
  };

  static list = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof listInventoryItems>>>(request, response, InventoryHandlers.list);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };

  static update = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof updateInventoryItem>>>(request, response, InventoryHandlers.update, {
      params: { itemId: routeParam(request) },
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

  static delete = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof deleteInventoryItem>>>(request, response, InventoryHandlers.remove, {
      params: { itemId: routeParam(request) }
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(404).json({ code: result.code, message: result.message });
      return;
    }
    response.status(204).send();
  };
}