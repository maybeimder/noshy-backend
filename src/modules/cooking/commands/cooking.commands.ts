import type { Arg } from '../../../core/commands/command-bus.js';
import type { CookingService } from '../cooking.service.js';

/** Comandos del módulo cooking. Modo cocina. */
export const cookingCommands = (s: { cooking: CookingService }) => ({
  'cooking.start': (c: { userId: string; input: Arg<CookingService['start'], 1> }) => s.cooking.start(c.userId, c.input),
  'cooking.recordEvents': (c: { userId: string; sessionId: string; events: Arg<CookingService['recordEvents'], 2> }) => s.cooking.recordEvents(c.userId, c.sessionId, c.events),
  'cooking.complete': (c: { userId: string; tz: string; sessionId: string; input: Arg<CookingService['complete'], 3> }) => s.cooking.complete(c.userId, c.tz, c.sessionId, c.input),
  'cooking.abandon': (c: { userId: string; sessionId: string; input: Arg<CookingService['abandon'], 2> }) => s.cooking.abandon(c.userId, c.sessionId, c.input),
});
