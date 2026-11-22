/**
 * Esquema completo de Postgres para Drizzle (lo lee drizzle-kit para generar migraciones).
 * Cada tabla vive en el modelo de su módulo; aquí solo se juntan.
 */
export * from '../../../modules/auth/auth.model.js';
export * from '../../../modules/account/account.model.js';
export * from '../../../modules/onboarding/onboarding.model.js';
export * from '../../../modules/catalog/catalog.model.js';
export * from '../../../modules/recipes/recipes.model.js';
export * from '../../../modules/community/community.model.js';
export * from '../../../modules/pantry/pantry.model.js';
export * from '../../../modules/receipts/receipts.model.js';
export * from '../../../modules/shopping/shopping.model.js';
export * from '../../../modules/menus/menus.model.js';
export * from '../../../modules/home/meals.model.js';
export * from '../../../modules/home/nudges.model.js';
export * from '../../../modules/cooking/cooking.model.js';
export * from '../../../modules/media/media.model.js';
export * from './infra.model.js';
