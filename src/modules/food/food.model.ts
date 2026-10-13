// Catálogo de alimentos (products_slim) y biblioteca de recetas de referencia (recipes_raw), ambos de solo lectura.

export const NUTRIENT_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'sugars_g',
  'added_sugars_g',
  'fat_g',
  'sat_fat_g',
  'trans_fat_g',
  'fiber_g',
  'salt_g',
  'sodium_mg'
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
// Los datos de Open Food Facts son de la comunidad: cualquier nutriente puede faltar.
export type Nutrients = Partial<Record<NutrientKey, number | null>>;

export type FoodState = 'raw' | 'cooked' | 'canned' | 'plain';

export type FoodServing = {
  label: string;
  grams: number;
  nutrients?: Nutrients;
};

// Fila del dropdown / autocompletado.
export type FoodSearchItem = {
  id: string;
  name: string;
  brand: string;
  state?: FoodState;
  isGeneric: boolean;
  image: string | null;
  kcalPer100g: number | null;
  baseServing: { label: string; grams: number };
};

export type FoodProduct = {
  id: string;
  name: string;
  brand: string;
  state?: FoodState;
  pairKey?: string;
  isGeneric: boolean;
  quantity: string | null;
  per100g: Nutrients;
  servings: FoodServing[];
  nutriscore?: string | null;
  nova?: number | null;
  allergens: string[];
  traces: string[];
  ingredients?: string | null;
  dietTags: string[];
  labels: string[];
  categories: string[];
  image: string | null;
  completeness?: number;
};

// Lo mínimo para calcular macros.
export type FoodNutritionFacts = Pick<FoodProduct, 'id' | 'name' | 'brand' | 'state' | 'per100g' | 'servings'>;

export type LibraryRecipeSummary = {
  id: number;
  title: string;
  ner: string[];
  nIngredients: number;
  // Ingredientes que la receta pide y el usuario no buscó.
  extraIngredients: number;
  url?: string;
};

export type LibraryRecipe = {
  id: number;
  title: string;
  ingredients: string[];
  directions: string[];
  ner: string[];
  nIngredients: number;
  source?: string;
  url?: string;
};

export type MacroLine = {
  foodId: string;
  name: string;
  brand: string;
  state?: FoodState;
  grams: number;
  nutrients: Nutrients;
  // Nutrientes que el producto no trae (cuentan como 0 en los totales).
  missing: NutrientKey[];
};

export type MacroSummary = {
  items: MacroLine[];
  totals: Nutrients;
  warnings: string[];
};

export type GeneratedRecipeIngredient = {
  name: string;
  grams: number;
  foodId: string | null;
  matchedName: string | null;
  state?: FoodState;
};

export type GeneratedRecipe = {
  id: string;
  title: string;
  servings: number;
  ingredients: GeneratedRecipeIngredient[];
  steps: string[];
  notes?: string;
  macros: {
    total: Nutrients;
    perServing: Nutrients;
    lines: MacroLine[];
  };
  warnings: string[];
};
