import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

type Kind = 'transactional' | 'dailyIdeas' | 'community';
type Push = { title: string; body: string; deepLink: string };

/** Push notifications. Solo reaccionan a eventos; ningún servicio llama al notificador directamente. */
export class NotificationsObserver extends EventObserver {
  readonly name = 'notifications';

  constructor(private readonly c: Container) {
    super();
    this.on('receipt.parsed', (e) =>
      this.push(e.payload.userId, { title: 'Factura lista', body: `Agregué ${e.payload.ingredientIds.length} productos a tu despensa`, deepLink: `noshy://receipts/${e.payload.receiptId}` }),
    );
    this.on('menu.generated', (e) =>
      this.push(e.payload.userId, { title: 'Tu menú está listo', body: 'Tu chef armó tus recetas de la semana', deepLink: `noshy://menus/${e.payload.menuId}` }, 'dailyIdeas'),
    );
    this.on('recipe.published', (e) =>
      this.push(e.payload.userId, { title: '¡Publicada!', body: 'Tu receta ya está en la comunidad', deepLink: `noshy://recipes/${e.payload.recipeId}` }, 'community'),
    );
    this.on('recipe.rejected', (e) =>
      this.push(e.payload.userId, { title: 'Tu receta necesita cambios', body: e.payload.reason, deepLink: `noshy://my-recipes/${e.payload.recipeId}` }),
    );
    this.on('comment.created', async (e) => {
      if (!e.payload.recipeAuthorId || e.payload.recipeAuthorId === e.payload.userId) return;
      await this.push(e.payload.recipeAuthorId, { title: 'Nuevo comentario', body: 'Alguien comentó tu receta', deepLink: `noshy://recipes/${e.payload.recipeId}/comments` }, 'community');
    });
  }

  /** Respeta Ajustes › Notificaciones. Lo transaccional (factura lista, receta rechazada) siempre sale. */
  private async push(userId: string, n: Push, kind: Kind = 'transactional') {
    if (kind !== 'transactional') {
      const u = await this.c.repos.users.findById(userId);
      if (!u || !u.settings.notifications[kind]) return;
    }
    await this.c.providers.notifier.push(userId, n);
  }
}
