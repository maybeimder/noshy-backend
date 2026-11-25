import type { Arg } from '../../../core/commands/command-bus.js';
import type { OnboardingService } from '../onboarding.service.js';
import type { PreferencesService } from '../preferences.service.js';

/** Comandos del módulo onboarding. Onboarding y preferencias. */
export const onboardingCommands = (s: { onboarding: OnboardingService; preferences: PreferencesService }) => ({
  'onboarding.saveDraft': (c: { userId: string; input: Arg<OnboardingService['saveDraft'], 1> }) => s.onboarding.saveDraft(c.userId, c.input),
  'onboarding.complete': (c: { userId: string; tz: string; payload: Arg<OnboardingService['complete'], 2> }) => s.onboarding.complete(c.userId, c.tz, c.payload),
  'onboarding.patchPreferences': (c: { userId: string; input: Arg<PreferencesService['patch'], 1> }) => s.preferences.patch(c.userId, c.input),
});
