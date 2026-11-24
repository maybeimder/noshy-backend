import type { Collection } from 'mongodb';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';

const TIMEOUT_MS = 10_000;
const PROJECTION = { title: 1, ingredients: 1, directions: 1, ner: 1, nIngredients: 1 } as const;

/** Biblioteca de recetas de Mongo (`recipes_raw`: RecipeNLG, ~2.2M, en inglés y sin macros). Solo lectura. */
export class RecipeLibraryRepository {
  private maxId: number | null = null;

  constructor(private readonly recipes: Collection<RawRecipeDoc>) {}

  /** Recetas que llevan todos esos ingredientes (en inglés, como en `ner`). Si no hay con todos, va soltando los últimos. */
  async search(ingredients: string[], limit: number): Promise<RawRecipeDoc[]> {
    for (let n = ingredients.length; n >= 1; n--) {
      const docs = await this.recipes
        .find({ ner: { $all: ingredients.slice(0, n) }, nIngredients: { $gte: 3, $lte: 12 }, 'directions.0': { $exists: true } }, { projection: PROJECTION, maxTimeMS: TIMEOUT_MS })
        .limit(limit)
        .toArray();
      if (docs.length) return docs;
    }
    return [];
  }

  /** Un tramo desde un punto al azar. Recorre por _id: cuesta lo mismo en cualquier parte. */
  async sample(limit: number): Promise<RawRecipeDoc[]> {
    if (this.maxId === null) {
      const [last] = await this.recipes.find({}, { projection: { _id: 1 }, maxTimeMS: TIMEOUT_MS }).sort({ _id: -1 }).limit(1).toArray();
      if (!last) return [];
      this.maxId = last._id;
    }
    const start = Math.floor(Math.random() * Math.max(1, this.maxId + 1 - limit));
    return this.recipes.find({ _id: { $gte: start } }, { projection: PROJECTION, maxTimeMS: TIMEOUT_MS }).sort({ _id: 1 }).limit(limit).toArray();
  }
}
