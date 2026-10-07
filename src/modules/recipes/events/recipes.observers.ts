import type { DomainEvent } from '../../../core/events/domain-event';
import { IdempotentObserver } from '../../../core/events/observer';
import { RecipeDeletedEvent, RecipePublishedEvent, RecipeUnpublishedEvent } from './recipe.events';

export interface CommunityFeedEntry {
  recipeId: string;
  title: string;
  authorUserId: string;
  publishedAt: string;
}

// Observer: indexa las recetas públicas (feed de comunidad) y las retira al despublicar o borrar.
export class CommunityNotificationEngine extends IdempotentObserver {
  private entries = new Map<string, CommunityFeedEntry>();

  feed(): CommunityFeedEntry[] {
    return [...this.entries.values()].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }

  protected handle(event: DomainEvent<any>): void {
    if (event instanceof RecipePublishedEvent) {
      const { recipe, userId } = event.payload;
      this.entries.set(recipe.id, {
        recipeId: recipe.id,
        title: recipe.title,
        authorUserId: userId,
        publishedAt: recipe.publishedAt ?? event.occurredAt
      });
    } else if (event instanceof RecipeUnpublishedEvent || event instanceof RecipeDeletedEvent) {
      this.entries.delete(event.payload.recipeId);
    }
  }

  protected clearState(): void {
    this.entries = new Map();
  }
}
