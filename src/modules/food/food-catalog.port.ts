import type { FoodCandidate, FoodNutritionFacts, FoodProduct, LibraryRecipe, LibraryRecipeSummary } from './food.model';

// Lo que guarda Mongo; los tags los deduce el servicio (food-tags.ts).
export type LibraryRecipeData = Omit<LibraryRecipe, 'tags'>;
export type LibraryRecipeSummaryData = Omit<LibraryRecipeSummary, 'tags'>;

// Puerto del catálogo (MongoDB de solo lectura). El adaptador real vive en infrastructure/database/mongo.
export interface FoodCatalogPort {
  // terms: palabras ya normalizadas (minúsculas, sin tildes). Todas deben aparecer. Devuelve hasta `max`
  // candidatos por popularidad; el orden final (relevancia) lo decide food-ranking.ts.
  findProductCandidates(terms: string[], max: number): Promise<FoodCandidate[]>;
  getProduct(id: string): Promise<FoodProduct | null>;
  getNutritionFacts(ids: string[]): Promise<FoodNutritionFacts[]>;
  // ingredients: nombres en inglés como en el campo `ner` de RecipeNLG.
  searchLibraryRecipes(ingredients: string[], options: { maxIngredients?: number; limit: number }): Promise<LibraryRecipeSummaryData[]>;
  getLibraryRecipes(ids: number[]): Promise<LibraryRecipeData[]>;
}

// Sin MONGO_URL: cada consulta falla y los servicios responden FOOD_CATALOG_UNAVAILABLE (503).
export function createUnavailableFoodCatalog(): FoodCatalogPort {
  const unavailable = async (): Promise<never> => {
    throw new Error('FOOD_CATALOG_NOT_CONFIGURED');
  };
  return {
    findProductCandidates: unavailable,
    getProduct: unavailable,
    getNutritionFacts: unavailable,
    searchLibraryRecipes: unavailable,
    getLibraryRecipes: unavailable
  };
}

// Normaliza igual que el campo `search` de products_slim: minúsculas y sin tildes.
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Conectores que no describen el alimento ("aceite DE oliva"): exigirlos solo agrega ruido.
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'a', 'al', 'para', 'sin', 'por', 'un', 'una']);

// Palabras de búsqueda: sin signos, sin conectores, sin repetidos, como mucho 6.
export function searchTerms(query: string): string[] {
  const words = normalizeSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !STOPWORDS.has(word));
  return [...new Set(meaningful.length > 0 ? meaningful : words)].slice(0, 6);
}
