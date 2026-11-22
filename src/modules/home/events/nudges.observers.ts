import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Cualquier cambio en la despensa o una receta cocinada recalcula los avisos del usuario. */
export class NudgesObserver extends EventObserver {
  readonly name = 'nudges';

  constructor(c: Container) {
    super();
    this.onEach(['pantry.items_added', 'pantry.item_updated', 'pantry.item_removed', 'pantry.items_consumed', 'cooking.completed'], async (e) => {
      if (!e.userId) return;
      const [user, prefs] = await Promise.all([c.repos.users.findById(e.userId), c.repos.preferences.get(e.userId)]);
      if (!user || !prefs) return;
      await c.services.nudges.refresh(e.userId, user.timezone, prefs.kitchen.mealsPerDay);
    });
  }
}
