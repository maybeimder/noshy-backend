import type { UsersRepository } from '../auth/auth.repository.js';
import type { CookingRepository } from '../cooking/cooking.repository.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import type { InsightsService } from '../chef/insights.service.js';
import { streakWeeks } from '../../core/domain/streak.js';
import { Errors } from '../../core/shared/errors.js';
import { localDate } from '../../core/shared/time.js';

/** Perfil: encabezado, estadísticas, lo que el chef aprendió y las preferencias redactadas. */
export class ProfileService {
  constructor(
    private readonly users: UsersRepository,
    private readonly cooking: CookingRepository,
    private readonly recipes: RecipesRepository,
    private readonly preferences: PreferencesService,
    private readonly insights: InsightsService,
  ) {}

  async get(userId: string, tz: string) {
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    const prefs = await this.preferences.getOrThrow(userId);
    const [cookedCount, publishedCount, dates, learning] = await Promise.all([
      this.cooking.completedCount(userId),
      this.recipes.countPublishedBy(userId),
      this.cooking.completedLocalDates(userId, new Date(Date.now() - 400 * 86_400_000)),
      this.insights.learning(userId),
    ]);
    return {
      user: {
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        displayName: [user.name, user.lastName].filter(Boolean).join(' '),
        initial: user.name.charAt(0).toUpperCase(),
        avatarUrl: user.avatarUrl,
        memberSince: user.createdAt.toISOString(),
      },
      stats: { cookedCount, publishedCount, streakWeeks: streakWeeks(dates, localDate(new Date(), tz)) },
      learning,
      preferences: this.preferences.rows(prefs, user.grammaticalGender),
      summary: this.preferences.summary(prefs),
      nutritionTargets: prefs.nutritionTargets,
      ...this.preferences.calculationInputs(prefs),
      onboardingStatus: user.onboardingStatus,
      updatedAt: prefs.updatedAt.toISOString(),
    };
  }
}
