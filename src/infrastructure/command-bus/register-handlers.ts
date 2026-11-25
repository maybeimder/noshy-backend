import { mergeHandlers } from '../../core/commands/command-bus.js';
import { accountCommands } from '../../modules/account/index.js';
import { authCommands } from '../../modules/auth/index.js';
import { authoringCommands } from '../../modules/authoring/index.js';
import { chefCommands } from '../../modules/chef/index.js';
import { communityCommands } from '../../modules/community/index.js';
import { cookingCommands } from '../../modules/cooking/index.js';
import { homeCommands } from '../../modules/home/index.js';
import { mediaCommands } from '../../modules/media/index.js';
import { menusCommands } from '../../modules/menus/index.js';
import { onboardingCommands } from '../../modules/onboarding/index.js';
import { pantryCommands } from '../../modules/pantry/index.js';
import { receiptsCommands } from '../../modules/receipts/index.js';
import { recipesCommands } from '../../modules/recipes/index.js';
import { shoppingCommands } from '../../modules/shopping/index.js';

/** Servicios que usan los handlers de todos los módulos. */
export type CommandServices = Parameters<typeof accountCommands>[0] &
  Parameters<typeof authCommands>[0] &
  Parameters<typeof authoringCommands>[0] &
  Parameters<typeof chefCommands>[0] &
  Parameters<typeof communityCommands>[0] &
  Parameters<typeof cookingCommands>[0] &
  Parameters<typeof homeCommands>[0] &
  Parameters<typeof mediaCommands>[0] &
  Parameters<typeof menusCommands>[0] &
  Parameters<typeof onboardingCommands>[0] &
  Parameters<typeof pantryCommands>[0] &
  Parameters<typeof receiptsCommands>[0] &
  Parameters<typeof recipesCommands>[0] &
  Parameters<typeof shoppingCommands>[0];

/** Comandos del sistema (cada módulo los declara en `commands/<módulo>.commands.ts`). */
export const createCommandHandlers = (s: CommandServices) =>
  mergeHandlers(
    accountCommands(s),
    authCommands(s),
    authoringCommands(s),
    chefCommands(s),
    communityCommands(s),
    cookingCommands(s),
    homeCommands(s),
    mediaCommands(s),
    menusCommands(s),
    onboardingCommands(s),
    pantryCommands(s),
    receiptsCommands(s),
    recipesCommands(s),
    shoppingCommands(s),
  );
