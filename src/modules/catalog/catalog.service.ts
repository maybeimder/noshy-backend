import type { CatalogRepository, DishRow, IngredientRow, ProductRow, StoreRow, SubstituteRow } from './catalog.repository.js';
import type { FoodRepository } from './food.repository.js';
import { foodIdOf, ingredientFromFood, ingredientFromText, isBaseIngredientId, isFoodIngredientId } from './food-ingredient.js';
import { normalizeText } from './food-text.js';
import { AppError } from '../../core/shared/errors.js';
import { cop } from '../../core/shared/money.js';
import { quantity, toGrams, type Quantity, type Unit } from '../../core/domain/quantity.js';
import type { IngredientFacts, SubstituteRule } from '../../core/domain/restrictions.js';
import type { IngredientNutrition } from '../../core/domain/nutrition.js';
import {
  ACTIVITY_LEVELS,
  ALLERGIES,
  CARE,
  COOKING_TIMES,
  DIET_STYLES,
  EQUIPMENT,
  GOALS,
  LIMITS,
  SKILL_LEVELS,
} from '../../core/domain/catalog.js';
import type { Labeled } from '../../core/domain/restrictions.js';

type Snapshot = Awaited<ReturnType<CatalogRepository['loadAll']>> & {
  ingById: Map<string, IngredientRow>;
  productsByIngredient: Map<string, ProductRow[]>;
  productById: Map<string, ProductRow>;
  price: Map<string, number>; // `${productId}|${storeId}`
  loadedAt: number;
};

const TTL_MS = 5 * 60_000;
export const CATALOG_VERSION = '2026-10-01';

/**
 * Catálogo en memoria (ingredientes, sustitutos, productos, precios, tiendas, platos).
 * Lo usan casi todos los servicios para etiquetas, cantidades, restricciones y precios.
 */
export class CatalogService {
  private snap: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(
    private readonly repo: CatalogRepository,
    private readonly foods: FoodRepository,
  ) {}

  async ready(): Promise<this> {
    if (!this.snap || Date.now() - this.snap.loadedAt > TTL_MS) await this.reload();
    return this;
  }

  async reload() {
    this.loading ??= this.repo.loadAll().then((d) => {
      const s: Snapshot = {
        ...d,
        ingById: new Map(d.ingredients.map((i) => [i.id, i])),
        productsByIngredient: new Map(),
        productById: new Map(d.products.map((p) => [p.id, p])),
        price: new Map(d.prices.map((p) => [`${p.productId}|${p.storeId}`, p.price])),
        loadedAt: Date.now(),
      };
      for (const p of d.products) {
        const list = s.productsByIngredient.get(p.ingredientId) ?? [];
        list.push(p);
        s.productsByIngredient.set(p.ingredientId, list);
      }
      this.snap = s;
      return s;
    });
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Deja listos los ingredientes antes de guardarlos. Los `food_*` (recomendados desde Mongo) que nadie ha usado
   * se copian a Postgres aquí: despensa, lista y recetas los referencian por llave foránea.
   * Los desconocidos se ignoran: cada servicio los valida como siempre.
   */
  async ensure(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !isBaseIngredientId(id) && !this.hasIngredient(id));
    if (missing.length === 0) return;
    const stored = await this.repo.ingredientsByIds(missing);
    const toImport = missing.filter((id) => isFoodIngredientId(id) && !stored.some((i) => i.id === id));
    if (toImport.length) {
      const docs = await this.foods.byIds(toImport.map(foodIdOf)).catch((cause: unknown) => {
        throw Object.assign(new AppError(503, 'FOOD_CATALOG_UNAVAILABLE', 'El catálogo de alimentos no responde. Intenta de nuevo.'), { cause });
      });
      if (docs.length) {
        const rows = docs.map(ingredientFromFood);
        await this.repo.insertIngredients(rows);
        stored.push(...rows);
      }
    }
    await this.remember(stored);
  }

  /** Ingrediente para un texto libre: el base si se llama igual («arroz» → Arroz); si no, uno creado con ese texto. */
  async ensureText(text: string): Promise<string> {
    const key = normalizeText(text.trim().replace(/\s+/g, ' '));
    const base = this.s.ingredients.find((i) => isBaseIngredientId(i.id) && normalizeText(i.label) === key);
    if (base) return base.id;
    const row = ingredientFromText(text);
    if (!this.hasIngredient(row.id)) {
      await this.repo.insertIngredients([row]);
      await this.remember([row]);
    }
    return row.id;
  }

  /** Agrega ingredientes ya armados (los del recetario). Los que existan se ignoran. */
  async addRows(rows: IngredientRow[]): Promise<void> {
    const fresh = [...new Map(rows.map((r) => [r.id, r])).values()].filter((r) => !this.hasIngredient(r.id));
    if (fresh.length === 0) return;
    await this.repo.insertIngredients(fresh);
    await this.remember(fresh);
  }

  private async remember(rows: IngredientRow[]) {
    // Una recarga en curso pudo leer antes del insert: se espera para no perder los nuevos.
    if (this.loading) await this.loading;
    for (const i of rows) {
      if (this.s.ingById.has(i.id)) continue;
      this.s.ingById.set(i.id, i);
      this.s.ingredients.push(i);
    }
  }

  /** Recarga si otro proceso agregó ingredientes (la API los copia de Mongo; el worker tiene su propia memoria). */
  async sync(): Promise<void> {
    if ((await this.repo.ingredientCount()) !== this.s.ingredients.length) await this.reload();
  }

  private get s(): Snapshot {
    if (!this.snap) throw new Error('CatalogService: llama a ready() antes de usarlo');
    return this.snap;
  }

  // ---------- Ingredientes ----------
  ingredient(id: string): IngredientRow | undefined {
    return this.s.ingById.get(id);
  }

  ingredientOrThrow(id: string): IngredientRow {
    const i = this.s.ingById.get(id);
    if (!i) throw new Error(`Ingrediente desconocido: ${id}`);
    return i;
  }

  hasIngredient(id: string) {
    return this.s.ingById.has(id);
  }

  label(id: string) {
    return this.s.ingById.get(id)?.label ?? id;
  }

  facts(id: string): IngredientFacts {
    const i = this.ingredientOrThrow(id);
    return { id: i.id, label: i.label, allergens: i.allergens, dietFlags: i.dietFlags };
  }

  nutrition(id: string): IngredientNutrition {
    const i = this.ingredientOrThrow(id);
    return { per100g: i.nutritionPer100g, gramsPerUnit: i.gramsPerUnit };
  }

  quantity(ingredientId: string | null, value: number | null, unit: Unit): Quantity {
    const i = ingredientId ? this.s.ingById.get(ingredientId) : undefined;
    return quantity(value, unit, i?.unitLabel ?? undefined);
  }

  substituteRules(): SubstituteRule[] {
    return this.s.substitutes
      .filter((r: SubstituteRow) => this.s.ingById.has(r.substituteId))
      .map((r) => ({ ingredientId: r.ingredientId, substitute: this.facts(r.substituteId), reason: r.reason, priority: r.priority }));
  }

  isBasic(id: string) {
    return this.s.ingById.get(id)?.isBasic ?? false;
  }

  /** Todas las palabras (raíces normalizadas) al inicio de alguna palabra del nombre; primero las que lo encabezan. */
  matching(stems: string[]): IngredientRow[] {
    const starts = (i: IngredientRow) => i.searchText.startsWith(stems[0]!);
    return this.s.ingredients
      .filter((i) => {
        const words = i.searchText.split(/[^a-z0-9]+/);
        return stems.every((s) => words.some((w) => w.startsWith(s)));
      })
      .sort((a, b) => Number(!starts(a)) - Number(!starts(b)) || a.label.localeCompare(b.label));
  }

  /** Solo ingredientes base: reconoce texto libre (exclusiones, facturas, «comí afuera») sin ruido de marcas. */
  search(q: string, limit: number) {
    const needle = q.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return this.s.ingredients
      .filter((i) => isBaseIngredientId(i.id) && i.searchText.includes(needle))
      .sort((a, b) => Number(!a.searchText.startsWith(needle)) - Number(!b.searchText.startsWith(needle)) || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  /** Gramos aproximados para comparar cantidades (despensa vs receta). */
  grams(ingredientId: string, value: number | null, unit: Unit): number | null {
    const i = this.s.ingById.get(ingredientId);
    return toGrams(value, unit, i?.gramsPerUnit ?? {});
  }

  // ---------- Productos y precios ----------
  product(id: string) {
    return this.s.productById.get(id);
  }

  productsFor(ingredientId: string) {
    return this.s.productsByIngredient.get(ingredientId) ?? [];
  }

  priceAt(productId: string, storeId: string): number | null {
    return this.s.price.get(`${productId}|${storeId}`) ?? null;
  }

  /** Productos de un ingrediente con su precio en la tienda (sin tienda: el más barato), del más barato al más caro. */
  productOptions(ingredientId: string, storeId?: string) {
    const stores = storeId ? [storeId] : this.s.stores.map((s) => s.id);
    return this.productsFor(ingredientId)
      .map((p) => {
        const prices = stores.map((s) => this.priceAt(p.id, s)).filter((x): x is number => x !== null);
        return { id: p.id, label: p.label, brand: p.brand, packLabel: p.packLabel, price: prices.length ? cop(Math.min(...prices)) : null };
      })
      .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity) || a.label.localeCompare(b.label));
  }

  /** Producto más barato de un ingrediente en una tienda. */
  cheapest(ingredientId: string, storeId: string): { product: ProductRow; price: number } | null {
    let best: { product: ProductRow; price: number } | null = null;
    for (const p of this.productsFor(ingredientId)) {
      const price = this.priceAt(p.id, storeId);
      if (price !== null && (!best || price < best.price)) best = { product: p, price };
    }
    return best;
  }

  genericProduct(ingredientId: string) {
    return this.productsFor(ingredientId).find((p) => p.brand === 'Genérico') ?? this.productsFor(ingredientId)[0];
  }

  /** Cuántos paquetes hacen falta para cubrir la cantidad pedida, y cuánto cuestan. */
  estimate(ingredientId: string, value: number | null, unit: Unit, storeId: string, productId?: string | null): { productId: string | null; price: number; packs: number } {
    const product = productId ? this.product(productId) : this.genericProduct(ingredientId);
    if (!product) return { productId: null, price: 0, packs: 0 };
    const unitPrice =
      this.priceAt(product.id, storeId) ??
      Math.min(...this.s.stores.map((s: StoreRow) => this.priceAt(product.id, s.id) ?? Number.POSITIVE_INFINITY));
    const needed = this.grams(ingredientId, value, unit) ?? (unit === product.packUnit ? value : null);
    const pack = this.grams(ingredientId, product.packValue, product.packUnit) ?? product.packValue;
    const packs = needed && pack ? Math.max(1, Math.ceil(needed / pack - 0.05)) : 1;
    return { productId: product.id, price: Number.isFinite(unitPrice) ? unitPrice * packs : 0, packs };
  }

  // ---------- Opciones del onboarding ----------
  stores(): StoreRow[] {
    return this.s.stores;
  }

  store(id: string) {
    return this.s.stores.find((s) => s.id === id);
  }

  dishes(): DishRow[] {
    return this.s.dishes;
  }

  dish(id: string) {
    return this.s.dishes.find((d) => d.id === id);
  }

  onboardingOptions() {
    return {
      version: CATALOG_VERSION,
      goals: GOALS,
      activityLevels: ACTIVITY_LEVELS.map(({ id, label, description }) => ({ id, label, description })),
      dietStyles: DIET_STYLES.map(({ id, label }) => ({ id, label })),
      allergies: ALLERGIES.map(({ id, label }) => ({ id, label })),
      care: CARE.map(({ id, label }) => ({ id, label })),
      dishes: this.s.dishes.map((d) => ({ id: d.id, label: d.label, imageUrl: d.imageUrl })),
      cookingTimes: COOKING_TIMES,
      skillLevels: SKILL_LEVELS,
      equipment: EQUIPMENT,
      stores: this.s.stores.map((s) => ({ id: s.id, name: s.name, logoUrl: s.logoUrl })),
      limits: LIMITS,
    };
  }

  categoryLabel(categoryId: string): string {
    return this.s.ingredients.find((i) => i.categoryId === categoryId)?.categoryLabel ?? categoryId;
  }

  conflictLabels(ingredientId: string, conflicts: Labeled[]) {
    return conflicts.map((c) => ({ id: c.id, label: c.label || this.label(ingredientId) }));
  }
}
