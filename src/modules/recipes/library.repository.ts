import type { Collection } from 'mongodb';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';

const TIMEOUT_MS = 10_000;

/** Biblioteca de recetas de Mongo (`recipes_raw`: RecipeNLG, ~2.2M, en inglés y sin macros). Solo lectura. */
export class RecipeLibraryRepository {
  constructor(private readonly recipes: Collection<RawRecipeDoc>) {}

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
