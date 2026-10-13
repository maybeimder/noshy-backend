import type { Collection, Db, Document } from 'mongodb';
import type { FoodCatalogPort } from '../../../modules/food/food-catalog.port';
import type {
  FoodNutritionFacts,
  FoodProduct,
  FoodSearchItem,
  FoodServing,
  LibraryRecipe,
  LibraryRecipeSummary,
  Nutrients
} from '../../../modules/food/food.model';

// Tiempo máximo por consulta: el dropdown no puede quedarse colgado.
const SEARCH_TIMEOUT_MS = 2_000;
const AGGREGATE_TIMEOUT_MS = 3_000;
// Tope de recetas candidatas que se ordenan: con un ingrediente común ("salt") $all coincide con cientos de miles.
const LIBRARY_SCAN_LIMIT = 5_000;

type ProductDoc = Document & {
  _id: string;
  name: string;
  displayName?: string;
  brand?: string;
  state?: FoodProduct['state'];
  pairKey?: string;
  isGeneric?: boolean;
  quantity?: string | null;
  per100g?: Nutrients;
  servings?: FoodServing[];
  nutriscore?: string | null;
  nova?: number | null;
  allergens?: string[];
  traces?: string[];
  ingredients?: string | null;
  dietTags?: string[];
  labels?: string[];
  categories?: string[];
  image?: string | null;
  completeness?: number;
};

type RecipeDoc = Document & {
  _id: number;
  title: string;
  ingredients?: string[];
  directions?: string[];
  ner?: string[];
  nIngredients?: number;
  source?: string;
  url?: string;
};

// Escapa el texto del usuario antes de meterlo en un regex (evita inyección de regex).
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BASE_SERVING: FoodServing = { label: '100 g', grams: 100 };

function displayName(doc: ProductDoc): string {
  return doc.displayName ?? doc.name;
}

// Adaptador de solo lectura: únicamente find() y aggregate() sin etapas de escritura.
export class MongoFoodCatalog implements FoodCatalogPort {
  private readonly products: Collection<ProductDoc>;
  private readonly recipes: Collection<RecipeDoc>;

  constructor(db: Db) {
    this.products = db.collection<ProductDoc>('products_slim');
    this.recipes = db.collection<RecipeDoc>('recipes_raw');
  }

  async searchProducts(terms: string[], limit: number): Promise<FoodSearchItem[]> {
    if (terms.length === 0) return [];
    const docs = await this.products
      .find(
        // Cada palabra debe aparecer al inicio de una palabra de `search` (texto ya normalizado).
        { $and: terms.map((term) => ({ search: { $regex: `\\b${escapeRegex(term)}` } })), suspect: { $ne: true } },
        {
          projection: { name: 1, displayName: 1, brand: 1, state: 1, isGeneric: 1, image: 1, 'per100g.kcal': 1, servings: { $slice: 1 } },
          sort: { popularity: -1, completeness: -1 },
          limit,
          maxTimeMS: SEARCH_TIMEOUT_MS
        }
      )
      .toArray();

    return docs.map((doc) => {
      const serving = doc.servings?.[0] ?? BASE_SERVING;
      return {
        id: doc._id,
        name: displayName(doc),
        brand: doc.brand ?? 'generic',
        ...(doc.state ? { state: doc.state } : {}),
        isGeneric: doc.isGeneric === true,
        image: doc.image ?? null,
        kcalPer100g: typeof doc.per100g?.kcal === 'number' ? doc.per100g.kcal : null,
        baseServing: { label: serving.label, grams: serving.grams }
      };
    });
  }

  async getProduct(id: string): Promise<FoodProduct | null> {
    const doc = await this.products.findOne(
      { _id: id },
      {
        projection: {
          name: 1, displayName: 1, brand: 1, state: 1, pairKey: 1, isGeneric: 1, quantity: 1, per100g: 1, servings: 1,
          nutriscore: 1, nova: 1, allergens: 1, traces: 1, ingredients: 1, dietTags: 1, labels: 1, categories: 1, image: 1, completeness: 1
        },
        maxTimeMS: SEARCH_TIMEOUT_MS
      }
    );
    if (!doc) return null;
    return {
      id: doc._id,
      name: displayName(doc),
      brand: doc.brand ?? 'generic',
      ...(doc.state ? { state: doc.state } : {}),
      ...(doc.pairKey ? { pairKey: doc.pairKey } : {}),
      isGeneric: doc.isGeneric === true,
      quantity: doc.quantity ?? null,
      per100g: doc.per100g ?? {},
      servings: doc.servings?.length ? doc.servings : [BASE_SERVING],
      nutriscore: doc.nutriscore ?? null,
      nova: doc.nova ?? null,
      allergens: doc.allergens ?? [],
      traces: doc.traces ?? [],
      ingredients: doc.ingredients ?? null,
      dietTags: doc.dietTags ?? [],
      labels: doc.labels ?? [],
      categories: doc.categories ?? [],
      image: doc.image ?? null,
      ...(typeof doc.completeness === 'number' ? { completeness: doc.completeness } : {})
    };
  }

  async getNutritionFacts(ids: string[]): Promise<FoodNutritionFacts[]> {
    if (ids.length === 0) return [];
    const docs = await this.products
      .find(
        { _id: { $in: ids } },
        { projection: { name: 1, displayName: 1, brand: 1, state: 1, per100g: 1, servings: 1 }, maxTimeMS: SEARCH_TIMEOUT_MS }
      )
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      name: displayName(doc),
      brand: doc.brand ?? 'generic',
      ...(doc.state ? { state: doc.state } : {}),
      per100g: doc.per100g ?? {},
      servings: doc.servings?.length ? doc.servings : [BASE_SERVING]
    }));
  }

  async searchLibraryRecipes(ingredients: string[], options: { maxIngredients?: number; limit: number }): Promise<LibraryRecipeSummary[]> {
    if (ingredients.length === 0) return [];
    const docs = await this.recipes
      .aggregate<RecipeDoc & { extra: number }>(
        [
          { $match: { ner: { $all: ingredients }, ...(options.maxIngredients ? { nIngredients: { $lte: options.maxIngredients } } : {}) } },
          { $limit: LIBRARY_SCAN_LIMIT },
          { $project: { title: 1, ner: 1, nIngredients: 1, url: 1, extra: { $size: { $setDifference: ['$ner', ingredients] } } } },
          { $match: { extra: { $lte: 4 } } },
          { $sort: { extra: 1, nIngredients: 1 } },
          { $limit: options.limit }
        ],
        { maxTimeMS: AGGREGATE_TIMEOUT_MS }
      )
      .toArray();
    return docs.map((doc) => ({
      id: doc._id,
      title: doc.title,
      ner: doc.ner ?? [],
      nIngredients: doc.nIngredients ?? doc.ner?.length ?? 0,
      extraIngredients: doc.extra,
      ...(doc.url ? { url: doc.url } : {})
    }));
  }

  async getLibraryRecipes(ids: number[]): Promise<LibraryRecipe[]> {
    if (ids.length === 0) return [];
    const docs = await this.recipes
      .find(
        { _id: { $in: ids } },
        { projection: { title: 1, ingredients: 1, directions: 1, ner: 1, nIngredients: 1, source: 1, url: 1 }, maxTimeMS: SEARCH_TIMEOUT_MS }
      )
      .toArray();
    const byId = new Map(docs.map((doc) => [doc._id, doc]));
    // Mismo orden en que se pidieron (las mejores referencias primero).
    return ids.flatMap((id) => {
      const doc = byId.get(id);
      if (!doc) return [];
      return [
        {
          id: doc._id,
          title: doc.title,
          ingredients: doc.ingredients ?? [],
          directions: doc.directions ?? [],
          ner: doc.ner ?? [],
          nIngredients: doc.nIngredients ?? doc.ner?.length ?? 0,
          ...(doc.source ? { source: doc.source } : {}),
          ...(doc.url ? { url: doc.url } : {})
        }
      ];
    });
  }
}
