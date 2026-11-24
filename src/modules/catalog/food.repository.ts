import type { Collection } from 'mongodb';
import type { FoodDoc } from '../../infrastructure/database/mongo/collections.js';
import { stem } from './food-text.js';

/** Tope por consulta: el autocompletado no puede quedarse colgado si Mongo no responde. */
const TIMEOUT_MS = 2_500;

/** `maxTimeMS` corta la consulta en el servidor; esto corta además la espera de conexión, que el driver no limita. */
function withTimeout<T>(query: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`products_slim no respondió en ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
  });
  return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
}

const PROJECTION = {
  name: 1, displayName: 1, brand: 1, state: 1, quantity: 1, per100g: 1, servings: 1, nova: 1, allergens: 1,
  ingredients: 1, dietTags: 1, labels: 1, foodGroups: 1, popularity: 1, completeness: 1,
} as const;

/** Catálogo de alimentos de Mongo (`products_slim`, ~7.6k). Solo lectura. */
export class FoodRepository {
  constructor(private readonly foods: Collection<FoodDoc>) {}

  /** Cada palabra debe aparecer al inicio de una palabra de `search`. Llegan por popularidad; la relevancia la pone `rankFoods`. */
  candidates(terms: string[], max: number): Promise<FoodDoc[]> {
    if (terms.length === 0) return Promise.resolve([]);
    // Los términos son [a-z0-9]+ (ver `searchTerms`): no hay caracteres especiales de regex que escapar.
    const match = terms.map((t) => ({ search: { $regex: `\\b${stem(t)}` } }));
    return withTimeout(
      this.foods
        .find({ $and: match, suspect: { $ne: true } }, { projection: PROJECTION, maxTimeMS: TIMEOUT_MS })
        .sort({ popularity: -1, completeness: -1 })
        .limit(max)
        .toArray(),
    );
  }

  byIds(ids: string[]): Promise<FoodDoc[]> {
    return withTimeout(this.foods.find({ _id: { $in: ids } }, { projection: PROJECTION, maxTimeMS: TIMEOUT_MS }).toArray());
  }

  isEmpty(): Promise<boolean> {
    return this.foods.findOne({}, { projection: { _id: 1 }, maxTimeMS: TIMEOUT_MS }).then((d) => d === null);
  }
}
