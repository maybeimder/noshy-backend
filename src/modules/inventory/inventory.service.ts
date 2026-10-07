import { randomUUID } from 'node:crypto';
import { db } from '../../infrastructure/persistence/persistence';
import { InventoryItemAddedEvent, InventoryItemRemovedEvent, InventoryItemUpdatedEvent } from './events/inventory.events';
import type { InventoryItem, InventoryItemInput, InventoryItemUpdate } from './inventory.model';

const notFound = { ok: false, code: 'INVENTORY_ITEM_NOT_FOUND', message: 'No existe el elemento solicitado.' } as const;

export async function addInventoryItem(userId: string, input: InventoryItemInput) {
  const item: InventoryItem = {
    id: randomUUID(),
    userId,
    name: input.name.trim(),
    quantity: Number(input.quantity),
    unit: input.unit.trim(),
    createdAt: new Date().toISOString()
  };

  return db().uow.transaction(async (tx) => {
    await db().inventory.insert(item, tx);
    await db().events.append([new InventoryItemAddedEvent({ userId, item })], tx);
    return item;
  });
}

export function listInventoryItems(userId: string) {
  return db().inventory.listByUser(userId);
}

export async function updateInventoryItem(userId: string, itemId: string, input: InventoryItemUpdate) {
  return db().uow.transaction(async (tx) => {
    const current = await db().inventory.findById(userId, itemId, tx);
    if (!current) {
      return notFound;
    }

    const item: InventoryItem = {
      ...current,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.quantity !== undefined ? { quantity: Number(input.quantity) } : {}),
      ...(input.unit !== undefined ? { unit: input.unit.trim() } : {})
    };
    await db().inventory.update(item, tx);
    await db().events.append([new InventoryItemUpdatedEvent({ userId, item })], tx);
    return { ok: true, data: item } as const;
  });
}

export async function deleteInventoryItem(userId: string, itemId: string) {
  return db().uow.transaction(async (tx) => {
    if (!(await db().inventory.delete(userId, itemId, tx))) {
      return notFound;
    }

    await db().events.append([new InventoryItemRemovedEvent({ userId, itemId })], tx);
    return { ok: true } as const;
  });
}
