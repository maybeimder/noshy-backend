import { randomUUID } from 'node:crypto';
import type { InventoryItem, InventoryItemInput } from './inventory.model';

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
