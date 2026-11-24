import type { UsersRepository } from '../auth/auth.repository.js';
import type { CookingRepository } from '../cooking/cooking.repository.js';
import type { DaysService } from './days.service.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import type { NudgesService } from './nudges.service.js';
import type { ChefService } from '../chef/chef.service.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import { cookedPhotoUrl } from '../cooking/kitchen.service.js';
import type { CookingService } from '../cooking/cooking.service.js';
import type { MealSlotId } from '../../core/domain/catalog.js';
import { localDate } from '../../core/shared/time.js';

const settled = <T>(p: PromiseSettledResult<T>): T | null => (p.status === 'fulfilled' ? p.value : null);

/**
 * Inicio en una llamada. Si una pieza falla, llega en null y el resto se pinta igual.
 */
export class HomeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly cookingRepo: CookingRepository,
    private readonly days: DaysService,
    private readonly recommendations: RecommendationsService,
    private readonly nudges: NudgesService,
    private readonly chef: ChefService,
    private readonly cooking: CookingService,
    private readonly storage: Storage,
  ) {}

  async get(userId: string, tz: string, date?: string) {
    const d = date ?? localDate(new Date(), tz);
    const user = await this.users.findById(userId);
    const day = await this.days.summary(userId, d, tz).catch(() => null);
    const slot = (day?.meals.find((m) => m.status === 'current')?.slot ?? 'lunch') as MealSlotId;
    const [ideas, nudge, mostCooked, unread, active] = await Promise.allSettled([
      this.recommendations.recommend(userId, { slot, limit: 3 }),
      this.nudges.list(userId, 'home'),
      this.cookingRepo.cooked(userId),
      this.chef.unreadMain(userId),
      this.cooking.active(userId),
    ]);
    const cooked = settled(mostCooked);
    return {
      greeting: { name: user?.name ?? '' },
      day,
      ideas: settled(ideas) ? { slot, items: settled(ideas)!.data } : null,
      nudge: settled(nudge)?.[0] ?? null,
      mostCooked: cooked
        ? cooked
            .sort((a, b) => b.timesCooked - a.timesCooked || b.lastCookedAt.localeCompare(a.lastCookedAt))
            .slice(0, 4)
            .map((r) => ({ recipeId: r.recipeId, title: r.title, imageUrl: cookedPhotoUrl(this.storage, r.photoKey) ?? r.imageUrl, timesCooked: r.timesCooked }))
        : null,
      chef: { unreadCount: settled(unread) ?? 0 },
      activeCookingSession: settled(active),
    };
  }
}
