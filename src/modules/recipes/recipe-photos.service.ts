import type { RecipesRepository } from './recipes.repository.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { dishPhoto } from './dish-photos.js';

/** Pone foto de referencia a las recetas que no tienen una propia. Nunca a las que publica una persona sin foto. */
export class RecipePhotosService {
  constructor(
    private readonly repo: RecipesRepository,
    private readonly catalog: CatalogService,
    private readonly baseUrl: string,
  ) {}

  url(r: { id: string; title: string }, ingredientIds: string[]): string | null {
    const known = ingredientIds.filter((id) => this.catalog.hasIngredient(id));
    const file = dishPhoto({
      ...r,
      ingredientLabels: known.map((id) => this.catalog.label(id)),
      dietFlags: known.flatMap((id) => this.catalog.facts(id).dietFlags),
    });
    return file && `${this.baseUrl}/api/v1/dishes/${file}`;
  }

  /** Al arrancar: las que ya estaban guardadas (y las que apuntan al CDN de muestra, que no existe). */
  async backfill(): Promise<number> {
    const rows = await this.repo.needingPhoto();
    const ingredients = await this.repo.ingredientsFor(rows.map((r) => r.id));
    let n = 0;
    for (const r of rows) {
      const ids = (ingredients.get(r.id) ?? []).map((i) => i.ingredientId);
      await this.catalog.ensure(ids);
      const url = this.url(r, ids);
      if (url === r.imageUrl) continue;
      await this.repo.setPhoto(r.id, r.imageUrl, url);
      n++;
    }
    return n;
  }
}
