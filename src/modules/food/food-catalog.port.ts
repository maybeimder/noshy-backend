import type { FoodNutritionFacts, FoodProduct, FoodSearchItem, LibraryRecipe, LibraryRecipeSummary } from './food.model';

// Puerto del catálogo (MongoDB de solo lectura). El adaptador real vive en infrastructure/database/mongo.
export interface FoodCatalogPort {
  // terms: palabras ya normalizadas (minúsculas, sin tildes). Todas deben aparecer.
  searchProducts(terms: string[], limit: number): Promise<FoodSearchItem[]>;
  getProduct(id: string): Promise<FoodProduct | null>;
  getNutritionFacts(ids: string[]): Promise<FoodNutritionFacts[]>;
  // ingredients: nombres en inglés como en el campo `ner` de RecipeNLG.
  searchLibraryRecipes(ingredients: string[], options: { maxIngredients?: number; limit: number }): Promise<LibraryRecipeSummary[]>;
  getLibraryRecipes(ids: number[]): Promise<LibraryRecipe[]>;
}

// Sin MONGO_URL: cada consulta falla y los servicios responden FOOD_CATALOG_UNAVAILABLE (503).
export function createUnavailableFoodCatalog(): FoodCatalogPort {
  const unavailable = async (): Promise<never> => {
    throw new Error('FOOD_CATALOG_NOT_CONFIGURED');
  };
  return {
    searchProducts: unavailable,
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

// Palabras de búsqueda: sin signos, sin repetidos, como mucho 6.
export function searchTerms(query: string): string[] {
  const words = normalizeSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return [...new Set(words)].slice(0, 6);
}
