import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Publicación con moderación asíncrona: `recipe.publish_requested` → `recipe.published` / `recipe.rejected`. */
export class CommunityObserver extends EventObserver {
  readonly name = 'community';

  constructor(c: Container) {
    super();
    this.on('recipe.publish_requested', async (e) => {
      await c.services.authoring.moderateAndPublish(e.payload.recipeId);
    });
  }
}
