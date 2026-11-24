import type { FastifyBaseLogger } from 'fastify';
import type { CatalogService } from './catalog.service.js';
import type { IngredientRow } from './catalog.repository.js';
import type { FoodRepository } from './food.repository.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import { foodBrand, foodName, ingredientFromFood, isBaseIngredientId, isFoodIngredientId } from './food-ingredient.js';
import { rankFoods } from './food-ranking.js';
import { normalizeText, searchTerms, stem } from './food-text.js';
import { alternativesFor } from './synonyms.js';
import { Errors, field } from '../../core/shared/errors.js';

/** Candidatos que se traen por popularidad antes de ordenarlos por relevancia. */
const CANDIDATE_POOL = 100;
/** Tras un fallo de Mongo no se vuelve a intentar en este rato: cada intento haría esperar a quien escribe. */
const RETRY_AFTER_MS = 10_000;

/**
 * Buscador de ingredientes (despensa, lista de compras, crear receta): marca los que chocan con el usuario.
 * Las recomendaciones salen del catálogo de alimentos de Mongo (`products_slim`). Los ingredientes base de Noshy
 * que coinciden van primero, porque son los que usan las recetas, pero nunca ocupan más de media lista.
 * Si sobra espacio se completa con sinónimos («palta» → aguacate, «cereal» → hojuelas de maíz).
 */
export class IngredientSearchService {
  private downUntil = 0;

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
    const [prefs, found] = await Promise.all([this.preferences.get(userId), this.find(terms, max)]);
    if (found.length < max) {
      for (const alternative of alternativesFor(terms)) {
        found.push(...(await this.find(searchTerms(alternative), max)));
        if (found.length >= max * 2) break;
      }
    }
    return this.unique(found)
      .slice(0, max)
      .map((i) => ({
        id: i.id,
        label: i.label,
        icon: i.icon,
        defaultUnit: i.defaultUnit,
        allowedUnits: i.allowedUnits,
        conflicts: this.preferences.conflictsForFacts(prefs, i),
      }));
  }

  /** Productos de un ingrediente, para elegir marca al añadirlo. Los alimentos de Mongo ya son un producto: no tienen. */
  products(ingredientId: string, storeId?: string) {
    if (storeId && !this.catalog.store(storeId)) throw Errors.validation([field('storeId', 'INVALID_OPTION', 'Tienda desconocida.')]);
    if (!this.catalog.hasIngredient(ingredientId) && !isFoodIngredientId(ingredientId)) throw Errors.notFound('Ese ingrediente no existe.');
    return this.catalog.productOptions(ingredientId, storeId);
  }

  private unique(list: IngredientRow[]) {
    const seen = new Set<string>();
    return list.filter((i) => {
      const key = normalizeText(i.label);
      return !seen.has(key) && seen.add(key);
    });
  }

  private async find(terms: string[], max: number): Promise<IngredientRow[]> {
    const foods = await this.searchFoods(terms);
    const own = this.catalog.matching(terms.map(stem));
    const base = own.filter((i) => isBaseIngredientId(i.id));
    const head = base.slice(0, foods?.length ? Math.max(Math.ceil(max / 2), max - foods.length) : max);
    // Sin Mongo quedan los base y los alimentos que alguien ya agregó (están copiados en Postgres).
    const rest = foods ?? own.filter((i) => isFoodIngredientId(i.id));

    return this.unique([...head, ...rest, ...base.slice(head.length)]);
  }

  /** null si Mongo no responde: el buscador sigue con lo que hay en Postgres. */
  private async searchFoods(terms: string[]): Promise<IngredientRow[] | null> {
    if (Date.now() < this.downUntil) return null;
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
      this.downUntil = Date.now() + RETRY_AFTER_MS;
      this.log.error({ err }, 'products_slim no responde: el buscador usa solo el catálogo local');
      return null;
    }
  }
}
