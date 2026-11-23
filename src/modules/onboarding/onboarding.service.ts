import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { PreferencesRepository } from './preferences.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { MenusRepository } from '../menus/menus.repository.js';
import type { PreferencesService, PreferencesInput } from './preferences.service.js';
import { computeTargets, type Biometrics } from '../../core/domain/nutrition.js';
import type { ActivityLevel, GoalId, OnboardingStep } from '../../core/domain/catalog.js';
import { Errors } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { localDate, weekStart } from '../../core/shared/time.js';

export type CompletePayload = PreferencesInput & { skippedSteps: OnboardingStep[] };

/**
 * Onboarding: borrador opcional y el paquete único que crea el chef.
 * Al completar, guarda todo en una transacción y emite `onboarding.completed`;
 * el menú y la lista de compras salen de ahí por eventos.
 */
export class OnboardingService {
  constructor(
    private readonly db: Db,
    private readonly prefsRepo: PreferencesRepository,
    private readonly users: UsersRepository,
    private readonly menus: MenusRepository,
    private readonly preferences: PreferencesService,
    private readonly outbox: Outbox,
  ) {}

  preview(input: { goalIds: GoalId[]; activityLevel: ActivityLevel; biometrics?: Biometrics | null }) {
    return computeTargets(input);
  }

  async state(userId: string) {
    const [user, draft] = await Promise.all([this.users.findById(userId), this.prefsRepo.getDraft(userId)]);
    if (!user) throw Errors.unauthorized();
    return {
      status: user.onboardingStatus,
      currentStep: draft?.currentStep ?? 'goals',
      skippedSteps: draft?.skippedSteps ?? [],
      draft: draft?.draft ?? {},
      updatedAt: (draft?.updatedAt ?? user.updatedAt).toISOString(),
    };
  }

  async saveDraft(userId: string, input: { currentStep: OnboardingStep; draft: Record<string, unknown>; skippedSteps?: OnboardingStep[] }) {
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    if (user.onboardingStatus === 'completed') throw Errors.conflict('ONBOARDING_ALREADY_COMPLETED', 'Ya configuraste tu chef. Para cambiar algo usa tus preferencias.');
    const existing = await this.prefsRepo.getDraft(userId);
    await this.db.transaction(async (tx) => {
      await this.prefsRepo.upsertDraft(tx, {
        userId,
        currentStep: input.currentStep,
        skippedSteps: input.skippedSteps ?? existing?.skippedSteps ?? [],
        draft: { ...(existing?.draft ?? {}), ...input.draft },
      });
      if (user.onboardingStatus === 'pending') await this.users.update(tx, userId, { onboardingStatus: 'inProgress' });
    });
    return this.state(userId);
  }

  async complete(userId: string, tz: string, payload: CompletePayload) {
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    if (user.onboardingStatus === 'completed') throw Errors.conflict('ONBOARDING_ALREADY_COMPLETED', 'Ya configuraste tu chef.');
    this.preferences.validate(payload);
    const resolved = this.preferences.resolve(payload);
    const menuId = newId('menu');
    await this.db.transaction(async (tx) => {
      await this.prefsRepo.upsert(tx, { userId, ...resolved, skippedSteps: payload.skippedSteps });
      await this.users.update(tx, userId, { onboardingStatus: 'completed', timezone: tz });
      await this.menus.create(tx, { id: menuId, userId, weekStart: weekStart(localDate(new Date(), tz)), status: 'generating', progress: { stage: 'restrictions', percent: 0 } });
      await this.outbox.record(tx, 'onboarding.completed', { userId, menuId, skippedSteps: payload.skippedSteps });
    });
    this.outbox.kick();
    const prefs = (await this.prefsRepo.get(userId))!;
    return {
      user: { id: userId, name: user.name },
      onboardingStatus: 'completed' as const,
      summary: this.preferences.summary(prefs),
      nutritionTargets: prefs.nutritionTargets,
      ...this.preferences.calculationInputs(prefs),
      updatedAt: prefs.updatedAt.toISOString(),
      firstMenu: { menuId, status: 'generating' as const, estimatedReadyInSeconds: 8 },
    };
  }
}
