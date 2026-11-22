import type { CookingRepository } from './cooking.repository.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { encodeCursor, decodeCursor } from '../../core/shared/cursor.js';
import { Errors, field } from '../../core/shared/errors.js';

const MEAT_FLAGS = ['meat', 'fish', 'shellfish'];

/** «Mi cocina»: lo que el usuario ha cocinado, con conteo y filtros (Proteína, Veggie, < 20 min). */
export class KitchenService {
  constructor(
    private readonly cooking: CookingRepository,
    private readonly recipesRepo: RecipesRepository,
    private readonly catalog: CatalogService,
  ) {}

  async cooked(userId: string, q: { filter?: string; sort?: 'recent' | 'mostCooked'; cursor?: string; limit?: number }) {
    const limit = Math.min(q.limit ?? 24, 100);
    const rows = await this.cooking.cooked(userId);
    const ingredients = await this.recipesRepo.ingredientsFor(rows.map((r) => r.recipeId));
    const traits = new Map(
      rows.map((r) => {
        const ings = (ingredients.get(r.recipeId) ?? []).map((i) => this.catalog.ingredient(i.ingredientId)).filter((i) => !!i);
        return [
          r.recipeId,
          {
            protein: ings.some((i) => i.categoryId === 'protein' || i.categoryId === 'seafood'),
            veggie: !ings.some((i) => i.dietFlags.some((f) => MEAT_FLAGS.includes(f))),
            under20: (r.timeMax ?? 99) <= 20,
          },
        ];
      }),
    );
    const facets = [
      { id: 'all', label: 'Todo', count: rows.length },
      { id: 'protein', label: 'Proteína', count: rows.filter((r) => traits.get(r.recipeId)!.protein).length },
      { id: 'veggie', label: 'Veggie', count: rows.filter((r) => traits.get(r.recipeId)!.veggie).length },
      { id: 'under20', label: '< 20 min', count: rows.filter((r) => traits.get(r.recipeId)!.under20).length },
    ];
    if (q.filter && !facets.some((f) => f.id === q.filter)) throw Errors.validation([field('filter', 'INVALID_OPTION', 'Filtro desconocido.')]);
    const filtered = rows.filter((r) => !q.filter || q.filter === 'all' || traits.get(r.recipeId)![q.filter as 'protein' | 'veggie' | 'under20']);
    filtered.sort((a, b) =>
      q.sort === 'mostCooked'
        ? b.timesCooked - a.timesCooked || b.lastCookedAt.localeCompare(a.lastCookedAt)
        : b.lastCookedAt.localeCompare(a.lastCookedAt) || b.recipeId.localeCompare(a.recipeId),
    );
    const offset = Number(decodeCursor(q.cursor)?.k ?? 0);
    const page = filtered.slice(offset, offset + limit);
    return {
      data: page.map((r) => ({
        recipe: { id: r.recipeId, title: r.title, imageUrl: r.imageUrl },
        timesCooked: r.timesCooked,
        lastCookedAt: new Date(r.lastCookedAt).toISOString(),
      })),
      meta: { nextCursor: offset + limit < filtered.length ? encodeCursor({ k: offset + limit, id: 'offset' }) : null, limit, facets },
    };
  }
}
