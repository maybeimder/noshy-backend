import { z } from 'zod';
import { MealSlot } from '../../../core/shared/common.dto.js';

export const StartBody = z.object({
  recipeId: z.string().min(3).max(64),
  servings: z.number().int().min(1).max(20),
  adaptationId: z.string().max(64).nullish(),
  mealSlot: MealSlot.optional(),
});
export const SessionParams = z.object({ sessionId: z.string().min(3).max(64) });
const at = z.iso.datetime({ offset: true });
const step = z.number().int().min(0).max(100);
export const EventsBody = z.object({
  events: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('stepEntered'), stepIndex: step, at }),
        z.object({ type: z.enum(['subStepStarted', 'timerPaused', 'timerResumed', 'heatChangeAcknowledged']), stepIndex: step, subStepIndex: step, at }),
        z.object({ type: z.literal('timerExtended'), stepIndex: step, subStepIndex: step, addedSeconds: z.number().int().min(1).max(3600), at }),
        z.object({ type: z.literal('voiceCommand'), command: z.enum(['next', 'back', 'repeat', 'pause', 'moreTime']), at }),
        z.object({ type: z.literal('speechToggled'), enabled: z.boolean(), at }),
      ]),
    )
    .min(1)
    .max(100),
});
export const CompleteBody = z.object({
  finishedAt: at,
  logMeal: z.object({ slot: MealSlot, servingsEaten: z.number().positive().max(10) }).nullable(),
  rating: z.number().int().min(1).max(5).optional(),
  photoMediaId: z.string().max(64).nullish(),
  pantryCorrections: z.array(z.object({ itemId: z.string(), remainingPct: z.number().int().min(0).max(100) })).max(50).optional(),
});
export const AbandonBody = z.object({ atStepIndex: step, reason: z.enum(['later', 'missingIngredient', 'tooHard', 'other']).nullish() });
