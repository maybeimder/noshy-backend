import type { Arg } from '../../../core/commands/command-bus.js';
import type { AuthoringService } from '../authoring.service.js';

/** Comandos del módulo authoring. Recetas propias. */
export const authoringCommands = (s: { authoring: AuthoringService }) => ({
  'authoring.create': (c: { userId: string; input: Arg<AuthoringService['create'], 1> }) => s.authoring.create(c.userId, c.input),
  'authoring.patch': (c: { userId: string; recipeId: string; patch: Arg<AuthoringService['patch'], 2>; ifMatch: string | undefined }) => s.authoring.patch(c.userId, c.recipeId, c.patch, c.ifMatch),
  'authoring.publish': (c: { userId: string; recipeId: string }) => s.authoring.publish(c.userId, c.recipeId),
  'authoring.unpublish': (c: { userId: string; recipeId: string }) => s.authoring.unpublish(c.userId, c.recipeId),
  'authoring.remove': (c: { userId: string; recipeId: string }) => s.authoring.remove(c.userId, c.recipeId),
});
