import { DomainEvent } from '../../../core/events/domain-event';

export class ShoppingListGeneratedEvent extends DomainEvent<{
  userId: string;
  recipeCount: number;
  missingItemCount: number;
}> {
  static readonly eventName = 'shopping.list_generated';
}