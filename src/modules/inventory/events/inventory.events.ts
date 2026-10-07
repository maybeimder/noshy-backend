import { DomainEvent } from '../../../core/events/domain-event';
import type { InventoryItem } from '../inventory.model';

export class InventoryItemAddedEvent extends DomainEvent<{ userId: string; item: InventoryItem }> {
  static readonly eventName = 'inventory.item_added';
}

export class InventoryItemUpdatedEvent extends DomainEvent<{ userId: string; item: InventoryItem }> {
  static readonly eventName = 'inventory.item_updated';
}

export class InventoryItemRemovedEvent extends DomainEvent<{ userId: string; itemId: string }> {
  static readonly eventName = 'inventory.item_removed';
}