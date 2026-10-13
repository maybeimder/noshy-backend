import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../../infrastructure/persistence/persistence';
import { getActiveNutritionPlan } from '../plans/plan.service';
import { FoodMealLoggedEvent, FoodRecipeGeneratedEvent } from './events/food.events';
import { FoodHistoryProjection } from './food-history.projection';
import {
  normalizeSearchText,
  searchTerms,
  type FoodCatalogPort,
  type LibraryRecipeCardData,
  type LibraryRecipeData,
  type LibraryRecipeSummaryData
} from './food-catalog.port';
import { rankFoods, type RankedFood } from './food-ranking';
import { inferRecipeTags } from './food-tags';
import {
  NUTRIENT_KEYS,
  type FoodNutritionFacts,
  type FoodSearchItem,
  type GeneratedRecipe,
  type GeneratedRecipeIngredient,
  type LibraryRecipe,
  type LibraryRecipeCard,
  type LibraryRecipeSummary,
  type MacroLine,
  type MacroSummary,
  type NutrientKey,
  type Nutrients
} from './food.model';
import {
  LIBRARY_SORTS,
  type FoodSearchInput,
  type LibraryBrowseInput,
  type LibrarySearchInput,
  type MacroCalculationInput,
  type RecipeGenerationInput
} from './http/food.dto';
import type { RecipeWriterPort } from './recipe-writer.port';

// Dependencias externas del módulo, inyectadas al armar el CommandBus (igual que el agente chef).
export type FoodDependencies = {
  catalog: FoodCatalogPort;
  writer: RecipeWriterPort;
};

const catalogUnavailable = {
  ok: false,
  code: 'FOOD_CATALOG_UNAVAILABLE',
  message: 'El catálogo de alimentos no está disponible.'
} as const;
const writerUnavailable = {
  ok: false,
  code: 'RECIPE_WRITER_UNAVAILABLE',
  message: 'El generador de recetas no está disponible.'
} as const;
const foodNotFound = (id: string) => ({ ok: false, code: 'FOOD_NOT_FOUND', message: `No existe el alimento ${id}.` }) as const;

// Envuelve una consulta al catálogo: si Mongo falla (caído, timeout), el resultado es 503, no un 500.
async function fromCatalog<T>(query: () => Promise<T>): Promise<{ ok: true; data: T } | typeof catalogUnavailable> {
  try {
    return { ok: true, data: await query() };
  } catch (error) {
    console.error('[food] Error consultando el catálogo:', error instanceof Error ? error.message : error);
    return catalogUnavailable;
  }
}

// ---------- Catálogo ----------

// Candidatos que se traen por popularidad antes de ordenarlos por relevancia. El catálogo es chico (~7.6k)
// y la proyección mínima, así que 100 es barato y cubre palabras comunes ("pollo" tiene ~90).
const CANDIDATE_POOL = 100;

function toSearchItem({ foodGroups: _groups, nova: _nova, popularity: _popularity, completeness: _completeness, score: _score, reliable, ...item }: RankedFood): FoodSearchItem {
  return { ...item, exactMatch: reliable };
}

async function rankedCandidates(catalog: FoodCatalogPort, terms: string[]): Promise<RankedFood[]> {
  return rankFoods(terms, await catalog.findProductCandidates(terms, CANDIDATE_POOL));
}

export async function searchFoods(catalog: FoodCatalogPort, input: FoodSearchInput) {
  const terms = searchTerms(input.q);
  if (terms.length === 0) return { ok: true, data: [] as FoodSearchItem[] } as const;
  const ranked = await fromCatalog(() => rankedCandidates(catalog, terms));
  if (!ranked.ok) return ranked;
  return { ok: true, data: ranked.data.slice(0, input.limit).map(toSearchItem) } as const;
}

export async function getFood(catalog: FoodCatalogPort, foodId: string) {
  const result = await fromCatalog(() => catalog.getProduct(foodId));
  if (!result.ok) return result;
  return result.data ? ({ ok: true, data: result.data } as const) : foodNotFound(foodId);
}

// ---------- Macros ----------

const round = (value: number) => Math.round(value * 10) / 10;

export function macroLine(product: FoodNutritionFacts, grams: number): MacroLine {
  const nutrients: Nutrients = {};
  const missing: NutrientKey[] = [];
  for (const key of NUTRIENT_KEYS) {
    const per100g = product.per100g[key];
    if (typeof per100g === 'number' && Number.isFinite(per100g)) {
      nutrients[key] = round((per100g * grams) / 100);
    } else {
      nutrients[key] = null;
      missing.push(key);
    }
  }
  return {
    foodId: product.id,
    name: product.name,
    brand: product.brand,
    ...(product.state ? { state: product.state } : {}),
    grams: round(grams),
    nutrients,
    missing
  };
}

// Suma las líneas. Un nutriente que ninguna línea trae queda en null; si solo falta en algunas, cuenta como 0.
export function sumNutrients(lines: MacroLine[], divisor = 1): Nutrients {
  const totals: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const values = lines.map((line) => line.nutrients[key]).filter((value): value is number => typeof value === 'number');
    totals[key] = values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / divisor) : null;
  }
  return totals;
}

function findServing(product: FoodNutritionFacts, label: string) {
  const wanted = normalizeSearchText(label).trim();
  return product.servings.find((serving) => normalizeSearchText(serving.label).trim() === wanted);
}

export async function calculateMacros(userId: string, catalog: FoodCatalogPort, input: MacroCalculationInput) {
  const ids = [...new Set(input.items.map((item) => item.foodId))];
  const facts = await fromCatalog(() => catalog.getNutritionFacts(ids));
  if (!facts.ok) return facts;
  const byId = new Map(facts.data.map((product) => [product.id, product]));

  const lines: MacroLine[] = [];
  const warnings: string[] = [];
  for (const item of input.items) {
    const product = byId.get(item.foodId);
    if (!product) return foodNotFound(item.foodId);

    let grams: number;
    if (item.grams !== undefined) {
      grams = item.grams;
    } else if (item.serving !== undefined) {
      const serving = findServing(product, item.serving);
      if (!serving) {
        return {
          ok: false,
          code: 'SERVING_NOT_FOUND',
          message: `"${product.name}" no tiene la porción "${item.serving}". Porciones: ${product.servings.map((option) => option.label).join(', ')}.`
        } as const;
      }
      grams = (item.quantity ?? 1) * serving.grams;
    } else {
      grams = 100;
      warnings.push(`Sin cantidad para "${product.name}": se usaron 100 g.`);
    }

    const line = macroLine(product, grams);
    if (line.missing.includes('kcal')) warnings.push(`"${product.name}" no trae calorías en el catálogo.`);
    lines.push(line);
  }

  const summary: MacroSummary = { items: lines, totals: sumNutrients(lines), warnings };
  if (!input.log) return { ok: true, data: summary } as const;

  const mealId = randomUUID();
  await db().uow.transaction(async (tx) => {
    await db().events.append(
      [
        new FoodMealLoggedEvent({
          userId,
          mealId,
          ...(input.label ? { label: input.label } : {}),
          items: lines.map((line) => ({ foodId: line.foodId, name: line.name, grams: line.grams })),
          totals: summary.totals
        })
      ],
      tx
    );
  });
  return { ok: true, data: { ...summary, mealId } } as const;
}

// ---------- Biblioteca de recetas (RecipeNLG) ----------

// Las traducciones se repiten mucho ("pollo", "arroz"): se guardan en memoria para no llamar al modelo cada vez.
const translations = new Map<string, string>();
const MAX_CACHED_TRANSLATIONS = 2_000;

// Español -> inglés (formato `ner`). Si el modelo no está, se usan los nombres tal cual (sirve si ya vienen en inglés).
async function toLibraryTerms(writer: RecipeWriterPort, names: string[]): Promise<{ terms: string[]; translated: boolean }> {
  const keys = names.map((name) => normalizeSearchText(name).trim());
  const pending = [...new Set(keys.filter((key) => !translations.has(key)))];
  let translated = true;
  if (pending.length > 0) {
    try {
      const english = await writer.translateIngredients(pending);
      pending.forEach((key, index) => {
        if (translations.size >= MAX_CACHED_TRANSLATIONS) translations.delete(translations.keys().next().value!);
        translations.set(key, english[index].trim());
      });
    } catch (error) {
      console.warn('[food] No se pudieron traducir los ingredientes:', error instanceof Error ? error.message : error);
      translated = false;
    }
  }
  const terms = keys.map((key) => translations.get(key) ?? key).filter(Boolean);
  return { terms: [...new Set(terms)], translated };
}

export async function searchLibraryRecipes(deps: FoodDependencies, input: LibrarySearchInput) {
  const { terms, translated } = await toLibraryTerms(deps.writer, input.ingredients);
  const recipes = await fromCatalog(() =>
    deps.catalog.searchLibraryRecipes(terms, { maxIngredients: input.maxIngredients, limit: input.limit })
  );
  if (!recipes.ok) return recipes;
  return {
    ok: true,
    data: {
      searchedIngredients: terms,
      translated,
      recipes: recipes.data.map(
        (recipe): LibraryRecipeSummary => ({ ...recipe, tags: inferRecipeTags({ title: recipe.title, ingredients: recipe.ner }) })
      )
    }
  } as const;
}

function withTags(recipe: LibraryRecipeData): LibraryRecipe {
  return { ...recipe, image: null, tags: inferRecipeTags({ title: recipe.title, ingredients: recipe.ner, steps: recipe.directions.length }) };
}

// ---------- Biblioteca paginada ----------

// Cursor opaco para el front. Guarda el orden y la posición (último _id); en `random`, además el _id de inicio
// y si ya se dio la vuelta al final de la colección. Así las páginas siguientes son estables y sin repetidos.
const cursorSchema = z.object({
  sort: z.enum(LIBRARY_SORTS),
  after: z.number().int().min(0),
  start: z.number().int().min(0).optional(),
  wrapped: z.boolean().optional()
});
type LibraryCursor = z.infer<typeof cursorSchema>;

const encodeCursor = (cursor: LibraryCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeCursor(value: string): LibraryCursor | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const toCard = (recipe: LibraryRecipeCardData): LibraryRecipeCard => ({
  ...recipe,
  image: null,
  tags: inferRecipeTags({ title: recipe.title, ingredients: recipe.ner })
});

// random: arranca en un _id al azar y avanza en orden; al llegar al final sigue desde 0 hasta el inicio.
// recent / oldest: _id descendente / ascendente. El dataset no tiene fechas: "recent" son los últimos en
// agregarse al dataset (Recipes1M), no recetas más nuevas.
export async function browseLibraryRecipes(catalog: FoodCatalogPort, input: LibraryBrowseInput) {
  const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
  if (cursor === null) return { ok: false, code: 'INVALID_CURSOR', message: 'El cursor de paginación no es válido.' } as const;
  const sort = cursor?.sort ?? input.sort;
  const filters = {
    limit: input.limit,
    ...(input.source ? { source: input.source } : {}),
    ...(input.maxIngredients ? { maxIngredients: input.maxIngredients } : {})
  };

  const page = await fromCatalog(async () => {
    if (sort === 'recent') {
      const items = await catalog.listLibraryRecipes({ ...filters, idRange: cursor ? { lt: cursor.after } : {}, order: 'desc' });
      return { items, next: items.length === input.limit ? { sort, after: items.at(-1)!.id } : null };
    }
    if (sort === 'oldest') {
      const items = await catalog.listLibraryRecipes({ ...filters, idRange: cursor ? { gt: cursor.after } : {}, order: 'asc' });
      return { items, next: items.length === input.limit ? { sort, after: items.at(-1)!.id } : null };
    }

    const start = cursor?.start ?? randomInt(0, (await catalog.maxLibraryRecipeId()) + 1);
    let wrapped = cursor?.wrapped ?? false;
    const items = wrapped
      ? await catalog.listLibraryRecipes({ ...filters, idRange: { gt: cursor!.after, lt: start }, order: 'asc' })
      : await catalog.listLibraryRecipes({ ...filters, idRange: cursor ? { gt: cursor.after } : { gte: start }, order: 'asc' });
    if (!wrapped && items.length < input.limit) {
      // Se llegó al final de la colección: se completa la página desde el principio.
      wrapped = true;
      items.push(...(await catalog.listLibraryRecipes({ ...filters, limit: input.limit - items.length, idRange: { gte: 0, lt: start }, order: 'asc' })));
    }
    return { items, next: items.length === input.limit ? { sort, after: items.at(-1)!.id, start, wrapped } : null };
  });
  if (!page.ok) return page;

  return {
    ok: true,
    data: {
      sort,
      limit: input.limit,
      items: page.data.items.map(toCard),
      // null = no hay más páginas.
      nextCursor: page.data.next ? encodeCursor(page.data.next) : null
    }
  } as const;
}

export async function getLibraryRecipe(catalog: FoodCatalogPort, recipeId: string) {
  const notFound = { ok: false, code: 'LIBRARY_RECIPE_NOT_FOUND', message: 'No existe la receta de referencia solicitada.' } as const;
  if (!/^\d{1,10}$/.test(recipeId)) return notFound;
  const result = await fromCatalog(() => catalog.getLibraryRecipes([Number(recipeId)]));
  if (!result.ok) return result;
  return result.data[0] ? ({ ok: true, data: withTags(result.data[0]) } as const) : notFound;
}

// Con muchos ingredientes `$all` casi nunca encuentra nada: se relaja quitando los últimos hasta tener referencias.
async function findReferences(catalog: FoodCatalogPort, terms: string[], wanted: number): Promise<LibraryRecipeSummaryData[]> {
  const found = new Map<number, LibraryRecipeSummaryData>();
  for (let size = terms.length; size >= Math.max(1, terms.length - 2) && found.size < wanted; size--) {
    const batch = await catalog.searchLibraryRecipes(terms.slice(0, size), { limit: wanted });
    for (const recipe of batch) if (!found.has(recipe.id)) found.set(recipe.id, recipe);
  }
  return [...found.values()].slice(0, wanted);
}

// ---------- Recetas generadas (RAG) ----------

// Nombre -> producto del catálogo, solo si es un match confiable (el producto ES el alimento). Para macros
// es mejor omitir un ingrediente (y avisarlo) que sumar los de una salchicha cuando se pidió pollo.
// "pimienta negra molida" sin resultados -> se reintenta con "pimienta negra" y luego "pimienta".
// En recetas, sin indicación se asume crudo: ante la duda se descarta lo cocido o enlatado.
export async function resolveFoodByName(catalog: FoodCatalogPort, name: string): Promise<RankedFood | null> {
  const terms = searchTerms(name);
  for (let size = terms.length; size >= 1; size--) {
    const ranked = (await rankedCandidates(catalog, terms.slice(0, size))).filter((item) => item.reliable);
    const match = ranked.find((item) => item.state !== 'cooked' && item.state !== 'canned') ?? ranked[0];
    if (match) return match;
  }
  return null;
}

export async function generateRecipe(userId: string, deps: FoodDependencies, input: RecipeGenerationInput) {
  const { catalog, writer } = deps;

  // 1. Los foodId que mandó el usuario deben existir.
  const requestedIds = [...new Set(input.ingredients.flatMap((item) => (item.foodId ? [item.foodId] : [])))];
  const requestedFacts = await fromCatalog(() => (requestedIds.length > 0 ? catalog.getNutritionFacts(requestedIds) : Promise.resolve([])));
  if (!requestedFacts.ok) return requestedFacts;
  const missingId = requestedIds.find((id) => !requestedFacts.data.some((product) => product.id === id));
  if (missingId) return foodNotFound(missingId);

  // 2. Recetas de referencia (RAG): traducir al inglés y buscar por `ner`. Sin modelo no hay receta que generar.
  const { terms, translated } = await toLibraryTerms(writer, input.ingredients.map((item) => item.name));
  if (!translated) return writerUnavailable;
  const summaries = await fromCatalog(() => findReferences(catalog, terms, 4));
  if (!summaries.ok) return summaries;
  const references = await fromCatalog(() => catalog.getLibraryRecipes(summaries.data.map((recipe) => recipe.id)));
  if (!references.ok) return references;

  // 3. El modelo redacta la receta (sin macros).
  const nutritionPlan = (await getActiveNutritionPlan(userId)) ?? undefined;
  let written;
  try {
    written = await writer.writeRecipe({
      ingredients: input.ingredients,
      references: references.data,
      servings: input.servings,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(nutritionPlan ? { nutritionPlan } : {})
    });
  } catch (error) {
    console.error('[food] El redactor de recetas falló:', error instanceof Error ? error.message : error);
    return writerUnavailable;
  }

  // 4. El back calcula los macros cruzando cada ingrediente con products_slim.
  const knownIds = new Set(requestedIds);
  const resolved = await fromCatalog(() =>
    Promise.all(
      written.ingredients.map(async (ingredient) => {
        if (ingredient.foodId && knownIds.has(ingredient.foodId)) return ingredient.foodId;
        return (await resolveFoodByName(catalog, ingredient.name))?.id ?? null;
      })
    )
  );
  if (!resolved.ok) return resolved;
  const extraIds = [...new Set(resolved.data.filter((id): id is string => id !== null && !knownIds.has(id)))];
  const extraFacts = await fromCatalog(() => (extraIds.length > 0 ? catalog.getNutritionFacts(extraIds) : Promise.resolve([])));
  if (!extraFacts.ok) return extraFacts;
  const facts = new Map([...requestedFacts.data, ...extraFacts.data].map((product) => [product.id, product]));

  const warnings: string[] = [];
  const lines: MacroLine[] = [];
  const ingredients: GeneratedRecipeIngredient[] = written.ingredients.map((ingredient, index) => {
    const product = resolved.data[index] ? facts.get(resolved.data[index]!) : undefined;
    if (!product) {
      warnings.push(`"${ingredient.name}" no tiene un equivalente fiable en el catálogo: no suma a los macros.`);
      return { name: ingredient.name, grams: ingredient.grams, foodId: null, matchedName: null };
    }
    lines.push(macroLine(product, ingredient.grams));
    return {
      name: ingredient.name,
      grams: ingredient.grams,
      foodId: product.id,
      matchedName: product.brand === 'generic' ? product.name : `${product.name} (${product.brand})`,
      ...(product.state ? { state: product.state } : {})
    };
  });

  const perServing = sumNutrients(lines, written.servings);
  const matchedProducts = ingredients.flatMap((ingredient) => (ingredient.foodId ? [facts.get(ingredient.foodId)!] : []));
  const recipe: GeneratedRecipe = {
    id: randomUUID(),
    title: written.title,
    servings: written.servings,
    ingredients,
    steps: written.steps,
    ...(written.notes ? { notes: written.notes } : {}),
    tags: inferRecipeTags({
      title: written.title,
      ingredients: ingredients.map((ingredient) => ingredient.name),
      steps: written.steps.length,
      productAllergens: matchedProducts.flatMap((product) => product.allergens),
      productFoodGroups: matchedProducts.flatMap((product) => product.foodGroups),
      ...(written.mealType ? { mealType: written.mealType } : {}),
      nutrientsPerServing: perServing
    }),
    macros: {
      total: sumNutrients(lines),
      perServing,
      lines
    },
    warnings
  };

  await db().uow.transaction(async (tx) => {
    await db().events.append(
      [
        new FoodRecipeGeneratedEvent({
          userId,
          recipe,
          requestedIngredients: input.ingredients,
          referenceRecipeIds: references.data.map((reference) => reference.id)
        })
      ],
      tx
    );
  });

  return {
    ok: true,
    data: {
      recipe,
      references: references.data.map(({ id, title, url }) => ({ id, title, ...(url ? { url } : {}) })),
      // Listo para guardarla con POST /recipes si al usuario le gusta.
      recipeInput: {
        title: recipe.title,
        ingredients: recipe.ingredients.map((ingredient) => ({ name: ingredient.name, quantity: ingredient.grams, unit: 'g' })),
        instructions: recipe.steps
      }
    }
  } as const;
}

// ---------- Historial (Event Sourcing) ----------

export async function getFoodHistory(userId: string, limit: number) {
  return FoodHistoryProjection.fromEvents(await db().events.readStream(userId)).history(limit);
}

export async function getGeneratedRecipe(userId: string, recipeId: string) {
  const entry = FoodHistoryProjection.fromEvents(await db().events.readStream(userId)).generatedRecipe(recipeId);
  return entry
    ? ({ ok: true, data: entry } as const)
    : ({ ok: false, code: 'GENERATED_RECIPE_NOT_FOUND', message: 'No existe la receta generada solicitada.' } as const);
}
