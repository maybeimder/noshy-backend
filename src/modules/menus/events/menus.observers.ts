import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Onboarding terminado → primer menú de la semana (`menu.generated`). */
export class MenusObserver extends EventObserver {
  readonly name = 'menus';

  constructor(c: Container) {
    super();
    this.on('onboarding.completed', async (e) => {
      const tz = (await c.repos.users.findById(e.payload.userId))?.timezone ?? 'America/Bogota';
      await c.services.menus.generate(e.payload.userId, e.payload.menuId, tz);
    });
  }
}
