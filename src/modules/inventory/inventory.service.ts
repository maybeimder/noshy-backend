import { randomUUID } from 'node:crypto';
import type { InventoryItem, InventoryItemInput, InventoryItemUpdate } from './inventory.model';

const inventoryByUserId = new Map<string, InventoryItem[]>();

export function addInventoryItem(userId: string, input: InventoryItemInput) {
  const item: InventoryItem = {
    id: randomUUID(),
    userId,
    name: input.name.trim(),
    quantity: Number(input.quantity),
    unit: input.unit.trim(),
    createdAt: new Date().toISOString()
  };

  const items = inventoryByUserId.get(userId) ?? [];
  items.push(item);
  inventoryByUserId.set(userId, items);
  return item;
}

export function listInventoryItems(userId: string) {
  return inventoryByUserId.get(userId) ?? [];
}

export function updateInventoryItem(userId: string, itemId: string, input: InventoryItemUpdate) {
  const item = listInventoryItems(userId).find((entry) => entry.id === itemId);
  if (!item) {
    return { ok: false, code: 'INVENTORY_ITEM_NOT_FOUND', message: 'No existe el elemento solicitado.' } as const;
  }

  if (input.name !== undefined) item.name = input.name.trim();
  if (input.quantity !== undefined) item.quantity = Number(input.quantity);
  if (input.unit !== undefined) item.unit = input.unit.trim();
  return { ok: true, data: item } as const;
}

export function deleteInventoryItem(userId: string, itemId: string) {
  const items = listInventoryItems(userId);
  const index = items.findIndex((entry) => entry.id === itemId);
  if (index === -1) {
    return { ok: false, code: 'INVENTORY_ITEM_NOT_FOUND', message: 'No existe el elemento solicitado.' } as const;
  }

  items.splice(index, 1);
  return { ok: true } as const;
}
