import type { RecipesRepository } from './recipes.repository.js';
import type { NutritionEstimator } from './recipes.providers.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { toGrams } from '../../core/domain/quantity.js';
import { Errors, field } from '../../core/shared/errors.js';

/** «Comí afuera»: estima kcal y macros de un texto libre antes de registrarlo. */
export class NutritionService {
  constructor(
    private readonly recipes: RecipesRepository,
    private readonly catalog: CatalogService,
    private readonly estimator: NutritionEstimator,
  ) {}

  async estimate(text: string) {
    if (!text.trim()) throw Errors.validation([field('text', 'EMPTY', 'Escribe qué comiste.')]);
    const published = await this.recipes.published();
    const ingredients = this.catalog.search('', 1000).map((i) => ({
      label: i.label,
      per100g: i.nutritionPer100g,
      typicalGrams: i.defaultUnit === 'g' || i.defaultUnit === 'ml' ? 100 : (toGrams(1, i.defaultUnit, i.gramsPerUnit) ?? 100),
    }));
    return this.estimator.estimate(text, {
      recipes: published.filter((r) => r.nutritionPerServing).map((r) => ({ title: r.title, perServing: r.nutritionPerServing! })),
      ingredients,
    });
  }
}
