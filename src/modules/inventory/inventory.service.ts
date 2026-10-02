import { randomUUID } from 'node:crypto';
import { getPlanById } from '../plans/plan.service';
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

const normalize = (value: string) => value.trim().toLowerCase();

export function getPlanInventoryCoverage(userId: string, planId: string) {
  const plan = getPlanById(userId, planId);
  if (!plan) {
    return { ok: false, code: 'PLAN_NOT_FOUND', message: 'No existe el plan solicitado.' } as const;
  }

  const availableByKey = new Map<string, number>();
  for (const item of listInventoryItems(userId)) {
    const key = `${normalize(item.name)}::${normalize(item.unit)}`;
    availableByKey.set(key, (availableByKey.get(key) ?? 0) + item.quantity);
  }

  const requiredByKey = new Map<string, { name: string; unit: string; quantity: number }>();
  for (const meal of plan.meals) {
    for (const ingredient of meal.ingredients) {
      const key = `${normalize(ingredient.name)}::${normalize(ingredient.unit)}`;
      const current = requiredByKey.get(key);
      if (current) {
        current.quantity += ingredient.quantity * meal.servings;
      } else {
        requiredByKey.set(key, {
          name: ingredient.name,
          unit: ingredient.unit,
          quantity: ingredient.quantity * meal.servings
        });
      }
    }
  }

  const items = [...requiredByKey.entries()].map(([key, required]) => {
    const availableQuantity = availableByKey.get(key) ?? 0;
    return {
      name: required.name,
      unit: required.unit,
      requiredQuantity: required.quantity,
      availableQuantity,
      missingQuantity: Math.max(required.quantity - availableQuantity, 0),
      covered: availableQuantity >= required.quantity
    };
  });

  return { ok: true, data: { planId, items } } as const;
}
