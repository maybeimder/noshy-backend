import type { Arg } from '../../../core/commands/command-bus.js';
import type { DaysService } from '../days.service.js';
import type { NudgesService } from '../nudges.service.js';

/** Comandos del módulo home. Comidas del día y avisos. */
export const homeCommands = (s: { days: DaysService; nudges: NudgesService }) => ({
  'home.logMeal': (c: { userId: string; date: string; tz: string; input: Arg<DaysService['log'], 3> }) => s.days.log(c.userId, c.date, c.tz, c.input),
  'home.deleteMeal': (c: { userId: string; date: string; tz: string; mealId: string }) => s.days.remove(c.userId, c.date, c.tz, c.mealId),
  'home.dismissNudge': (c: { userId: string; nudgeId: string; reason: Arg<NudgesService['dismiss'], 2> }) => s.nudges.dismiss(c.userId, c.nudgeId, c.reason),
});
