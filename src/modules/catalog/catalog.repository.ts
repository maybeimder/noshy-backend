import { asc, count, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import { dishes, ingredients, ingredientSubstitutes, productPrices, products, stores } from '../../infrastructure/database/postgres/schema.js';

export type IngredientRow = typeof ingredients.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type StoreRow = typeof stores.$inferSelect;
export type DishRow = typeof dishes.$inferSelect;
export type SubstituteRow = typeof ingredientSubstitutes.$inferSelect;
export type PriceRow = typeof productPrices.$inferSelect;

/** Lecturas del catálogo. El servicio lo cachea en memoria: cambia poco y se consulta muchísimo. */
export class CatalogRepository {
  constructor(private readonly db: Db) {}

  async ingredientCount(): Promise<number> {
    const [r] = await this.db.select({ n: count() }).from(ingredients);
    return r?.n ?? 0;
  }

  ingredientsByIds(ids: string[]): Promise<IngredientRow[]> {
    return this.db.select().from(ingredients).where(inArray(ingredients.id, ids));
  }

  async insertIngredients(rows: IngredientRow[]): Promise<void> {
    await this.db.insert(ingredients).values(rows).onConflictDoNothing();
  }

  loadAll() {
    return Promise.all([
      this.db.select().from(ingredients),
      this.db.select().from(ingredientSubstitutes),
      this.db.select().from(products),
      this.db.select().from(productPrices),
      this.db.select().from(stores).orderBy(asc(stores.sort)),
      this.db.select().from(dishes).orderBy(asc(dishes.sort)),
    ]).then(([ing, subs, prods, prices, st, ds]) => ({ ingredients: ing, substitutes: subs, products: prods, prices, stores: st, dishes: ds }));
  }
}
