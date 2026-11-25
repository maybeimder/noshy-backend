import type { Arg } from '../../../core/commands/command-bus.js';
import type { PantryService } from '../pantry.service.js';
import type { PantrySetupService } from '../pantry-setup.service.js';

/** Comandos del módulo pantry. Despensa. */
export const pantryCommands = (s: { pantry: PantryService; pantrySetup: PantrySetupService }) => ({
  'pantry.add': (c: { userId: string; tz: string; body: Arg<PantryService['add'], 2> }) => s.pantry.add(c.userId, c.tz, c.body),
  'pantry.patch': (c: { userId: string; itemId: string; patch: Arg<PantryService['patch'], 2> }) => s.pantry.patch(c.userId, c.itemId, c.patch),
  'pantry.remove': (c: { userId: string; itemId: string; addToShoppingList: boolean }) => s.pantry.remove(c.userId, c.itemId, c.addToShoppingList),
  'pantry.bulkSetup': (c: { userId: string; tz: string; input: Arg<PantrySetupService['bulk'], 2> }) => s.pantrySetup.bulk(c.userId, c.tz, c.input),
});
