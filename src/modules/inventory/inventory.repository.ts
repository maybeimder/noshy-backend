import type { Tx } from '../../core/persistence/unit-of-work';
import type { InventoryItem } from './inventory.model';

export interface InventoryRepository {
  listByUser(userId: string, tx?: Tx): Promise<InventoryItem[]>;
  findById(userId: string, itemId: string, tx?: Tx): Promise<InventoryItem | null>;
  insert(item: InventoryItem, tx?: Tx): Promise<void>;
  update(item: InventoryItem, tx?: Tx): Promise<void>;
  delete(userId: string, itemId: string, tx?: Tx): Promise<boolean>;
}

export class InMemoryInventoryRepository implements InventoryRepository {
  private readonly byUser = new Map<string, InventoryItem[]>();

  async listByUser(userId: string) {
    return this.byUser.get(userId) ?? [];
  }

  async findById(userId: string, itemId: string) {
    return (this.byUser.get(userId) ?? []).find((entry) => entry.id === itemId) ?? null;
  }

  async insert(item: InventoryItem) {
    const items = this.byUser.get(item.userId) ?? [];
    items.push(item);
    this.byUser.set(item.userId, items);
  }

  async update(item: InventoryItem) {
    const items = this.byUser.get(item.userId) ?? [];
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index !== -1) items[index] = item;
  }

  async delete(userId: string, itemId: string) {
    const items = this.byUser.get(userId) ?? [];
    const index = items.findIndex((entry) => entry.id === itemId);
    if (index === -1) return false;
    items.splice(index, 1);
    return true;
  }
}
