import type { Container } from '../../container.js';
import type { Observer } from '../../core/events/observer.js';
import { AccountObserver } from '../../modules/account/index.js';
import { ChefObserver, LearningObserver } from '../../modules/chef/index.js';
import { CommunityObserver } from '../../modules/community/index.js';
import { NudgesObserver } from '../../modules/home/index.js';
import { MenusObserver } from '../../modules/menus/index.js';
import { NotificationsObserver } from '../../modules/notifications/index.js';
import { ReceiptsObserver } from '../../modules/receipts/index.js';
import { ShoppingObserver } from '../../modules/shopping/index.js';

/**
 * Observers del sistema (cada módulo los declara en `events/<módulo>.observers.ts`).
 * Cada Subject de usuario los recibe a todos; cada uno decide a qué eventos reacciona.
 * Su `name` es estable: cambiarlo hace que vuelvan a procesar eventos ya vistos.
 */
export function createObservers(c: Container): Observer[] {
  return [
    new AccountObserver(c),
    new MenusObserver(c),
    new ShoppingObserver(c),
    new ReceiptsObserver(c),
    new ChefObserver(c),
    new LearningObserver(c),
    new NudgesObserver(c),
    new CommunityObserver(c),
    new NotificationsObserver(c),
  ];
}
