import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Factura procesada → mensaje proactivo del chef en el hilo principal. */
export class ChefObserver extends EventObserver {
  readonly name = 'chef';

  constructor(c: Container) {
    super();
    this.on('receipt.parsed', async (e) => {
      const user = await c.repos.users.findById(e.payload.userId);
      if (!user || user.onboardingStatus !== 'completed') return;
      const cat = c.services.catalog;
      // Lo más útil para proponer un plato: una proteína y una verdura («pollo y tomate»).
      const ings = [...new Set(e.payload.ingredientIds)].map((id) => cat.ingredient(id)).filter((i) => !!i && !i.isBasic);
      const protein = ings.find((i) => i!.categoryId === 'protein' || i!.categoryId === 'seafood');
      const produce = ings.find((i) => i!.categoryId === 'produce');
      const picked = [protein, produce].filter(Boolean).length ? [protein, produce].filter(Boolean) : ings.slice(0, 2);
      const labels = picked.map((i) => i!.label.split(' de ').pop()!);
      await c.services.chef.proactiveFromReceipt(e.payload.userId, user.timezone, labels, e.payload.purchasedAt ? new Date(e.payload.purchasedAt) : null);
    });
  }
}
