import type { FastifyInstance } from 'fastify';
import { accountRoutes } from '../../modules/account/index.js';
import { authRoutes } from '../../modules/auth/index.js';
import { authoringRoutes } from '../../modules/authoring/index.js';
import { catalogRoutes } from '../../modules/catalog/index.js';
import { chefRoutes } from '../../modules/chef/index.js';
import { communityRoutes } from '../../modules/community/index.js';
import { cookingRoutes } from '../../modules/cooking/index.js';
import { homeRoutes } from '../../modules/home/index.js';
import { mediaRoutes } from '../../modules/media/index.js';
import { menusRoutes } from '../../modules/menus/index.js';
import { onboardingRoutes } from '../../modules/onboarding/index.js';
import { pantryRoutes } from '../../modules/pantry/index.js';
import { profileRoutes } from '../../modules/profile/index.js';
import { receiptsRoutes } from '../../modules/receipts/index.js';
import { recipesRoutes } from '../../modules/recipes/index.js';
import { shoppingRoutes } from '../../modules/shopping/index.js';

/** Rutas de cada módulo bajo /api/v1. Cada módulo declara las suyas en `http/<módulo>.routes.ts`. */
export async function apiV1(app: FastifyInstance) {
  // El worker también agrega ingredientes (recetas de la biblioteca): la memoria de la API se pone al día.
  app.addHook('preHandler', async (req) => {
    await app.container.services.catalog.sync().catch((err: unknown) => req.log.warn({ err }, 'catálogo sin refrescar'));
  });
  for (const routes of [
    authRoutes,
    accountRoutes,
    onboardingRoutes,
    catalogRoutes,
    mediaRoutes,
    pantryRoutes,
    receiptsRoutes,
    menusRoutes,
    homeRoutes,
    chefRoutes,
    shoppingRoutes,
    recipesRoutes,
    cookingRoutes,
    communityRoutes,
    authoringRoutes,
    profileRoutes,
  ]) {
    await app.register(routes);
  }
}
