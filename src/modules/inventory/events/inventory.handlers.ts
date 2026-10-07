// Entrada única (HTTP y RabbitMQ) del módulo de inventario.
import { defineHandler } from '../../../core/commands/command-bus';
import { inventoryItemSchema, inventoryItemUpdateSchema } from '../http/inventory.dto';
import { addInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from '../inventory.service';

export const InventoryHandlers = {
  add: 'inventory.add',
  list: 'inventory.list',
  update: 'inventory.update',
  remove: 'inventory.remove'
} as const;

export const inventoryHandlers = [
  defineHandler({ name: InventoryHandlers.add, schema: inventoryItemSchema, execute: ({ userId, data }) => addInventoryItem(userId, data) }),
  defineHandler({ name: InventoryHandlers.list, execute: ({ userId }) => listInventoryItems(userId) }),
  defineHandler({
    name: InventoryHandlers.update,
    schema: inventoryItemUpdateSchema,
    params: ['itemId'],
    execute: ({ userId, params, data }) => updateInventoryItem(userId, params.itemId!, data)
  }),
  defineHandler({
    name: InventoryHandlers.remove,
    params: ['itemId'],
    execute: ({ userId, params }) => deleteInventoryItem(userId, params.itemId!)
  })
];
