import type { Collection } from 'mongodb';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';

const TIMEOUT_MS = 10_000;

/** Biblioteca de recetas de Mongo (`recipes_raw`: RecipeNLG, ~2.2M, en inglés y sin macros). Solo lectura. */
export class RecipeLibraryRepository {
  constructor(private readonly recipes: Collection<RawRecipeDoc>) {}

  /**
   * Recetas que llevan todos esos ingredientes (en inglés, como en `ner`), primero las que piden menos cosas de más.
   * Si no hay ninguna con todos, va soltando los últimos.
   */
  async search(ingredients: string[], limit: number): Promise<RawRecipeDoc[]> {
    for (let n = ingredients.length; n >= 1; n--) {
      const docs = await this.recipes
        .find({ ner: { $all: ingredients.slice(0, n) }, nIngredients: { $gte: 3, $lte: 12 }, 'directions.0': { $exists: true } }, { maxTimeMS: TIMEOUT_MS })
        .limit(limit)
        .toArray();
      if (docs.length) return docs.sort((a, b) => (a.nIngredients ?? 0) - (b.nIngredients ?? 0));
    }
    return [];
  }

  /** Recetas manejables a partir de un punto al azar. Recorre por _id: cuesta lo mismo en cualquier parte. */
  async sample(limit: number, random = Math.random): Promise<RawRecipeDoc[]> {
    const [last] = await this.recipes.find({}, { projection: { _id: 1 }, maxTimeMS: TIMEOUT_MS }).sort({ _id: -1 }).limit(1).toArray();
    if (!last) return [];
    const start = Math.floor(random() * (last._id + 1));
    const page = (range: { $gte?: number; $lt?: number }) =>
      this.recipes
        .find({ _id: range, nIngredients: { $gte: 4, $lte: 10 }, 'directions.1': { $exists: true }, 'directions.10': { $exists: false } }, { maxTimeMS: TIMEOUT_MS })
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();
    const docs = await page({ $gte: start });
    return docs.length ? docs : page({ $lt: start });
  }
}
