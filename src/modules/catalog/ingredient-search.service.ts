import type { FastifyBaseLogger } from 'fastify';
import type { CatalogService } from './catalog.service.js';
import type { IngredientRow } from './catalog.repository.js';
import type { FoodRepository } from './food.repository.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import { foodBrand, foodName, ingredientFromFood, isFoodIngredientId } from './food-ingredient.js';
import { rankFoods } from './food-ranking.js';
import { normalizeText, searchTerms, stem } from './food-text.js';

/** Candidatos que se traen por popularidad antes de ordenarlos por relevancia. */
const CANDIDATE_POOL = 100;

/**
 * Buscador de ingredientes (despensa, lista de compras, crear receta): marca los que chocan con el usuario.
 * Las recomendaciones salen del catálogo de alimentos de Mongo (`products_slim`). Los ingredientes base de Noshy
 * que coinciden van primero, porque son los que usan las recetas, pero nunca ocupan más de media lista.
 */
export class IngredientSearchService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly foods: FoodRepository,
    private readonly preferences: PreferencesService,
    private readonly log: FastifyBaseLogger,
  ) {}

  async search(userId: string, q: string, limit = 10) {
    const terms = searchTerms(q);
    if (terms.length === 0) return [];
    const max = Math.min(limit, 30);
    const [prefs, foods] = await Promise.all([this.preferences.get(userId), this.searchFoods(terms)]);

    const own = this.catalog.matching(terms.map(stem));
    const base = own.filter((i) => !isFoodIngredientId(i.id));
    const head = base.slice(0, foods?.length ? Math.max(Math.ceil(max / 2), max - foods.length) : max);
    // Sin Mongo quedan los base y los alimentos que alguien ya agregó (están copiados en Postgres).
    const rest = foods ?? own.filter((i) => isFoodIngredientId(i.id));

    const seen = new Set<string>();
    const unique = [...head, ...rest, ...base.slice(head.length)].filter((i) => {
      const key = normalizeText(i.label);
      return !seen.has(key) && seen.add(key);
    });
    return unique.slice(0, max).map((i) => ({
      id: i.id,
      label: i.label,
      icon: i.icon,
      defaultUnit: i.defaultUnit,
      allowedUnits: i.allowedUnits,
      conflicts: this.preferences.conflictsForFacts(prefs, i),
    }));
  }

  /** null si Mongo no responde: el buscador sigue con lo que hay en Postgres. */
  private async searchFoods(terms: string[]): Promise<IngredientRow[] | null> {
    try {
      const docs = await this.foods.candidates(terms, CANDIDATE_POOL);
      const ranked = rankFoods(
        terms,
        docs.map((doc) => ({
          doc,
          name: foodName(doc),
          brand: foodBrand(doc),
          foodGroups: doc.foodGroups ?? [],
          nova: typeof doc.nova === 'number' ? doc.nova : null,
          popularity: doc.popularity ?? 0,
          completeness: doc.completeness ?? 0,
        })),
      );
      return ranked.map((r) => ingredientFromFood(r.doc)).filter((i) => isFoodIngredientId(i.id));
    } catch (err) {
      this.log.error({ err }, 'products_slim no responde: el buscador usa solo el catálogo local');
      return null;
    }
  }
}
