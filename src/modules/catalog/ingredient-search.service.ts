import type { CatalogService } from './catalog.service.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';

/** Buscador de ingredientes (crear receta, despensa): marca los que chocan con las restricciones del usuario. */
export class IngredientSearchService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly preferences: PreferencesService,
  ) {}

  async search(userId: string, q: string, limit = 10) {
    const prefs = await this.preferences.get(userId);
    return this.catalog.search(q, Math.min(limit, 30)).map((i) => ({
      id: i.id,
      label: i.label,
      icon: i.icon,
      defaultUnit: i.defaultUnit,
      allowedUnits: i.allowedUnits,
      conflicts: this.preferences.conflictsFor(prefs, i.id),
    }));
  }
}
