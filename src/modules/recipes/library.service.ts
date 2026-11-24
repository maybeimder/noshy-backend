import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { allergensIn } from '../catalog/food-ingredient.js';
import type { RecipesRepository } from './recipes.repository.js';
import type { RecipeLibraryRepository } from './library.repository.js';
import type { EstimatedRecipe, RecipeEstimator } from './library.providers.js';
import { CUISINES } from '../../core/domain/catalog.js';

/** Recetas por llamada al modelo: menos llamadas (las cuentas gratuitas tienen tope diario). */
const PER_CALL = 4;
const SPARE = 3;

export const libraryRecipeId = (sourceId: number) => `rcp_lib_${sourceId}`;

/**
 * Trae recetas de `recipes_raw` a las recomendaciones con macros ESTIMADOS por un modelo. No se cruzan sus ingredientes
 * con el catálogo: son texto, y sirven para mostrarlos y detectar alérgenos. Los macros quedan guardados con la receta.
 */
export class RecipeLibraryService {
  constructor(
    private readonly db: Db,
    private readonly library: RecipeLibraryRepository,
    private readonly repo: RecipesRepository,
    private readonly catalog: CatalogService,
    private readonly estimator: RecipeEstimator | null,
    private readonly log: FastifyBaseLogger,
  ) {}

  get enabled() {
    return this.estimator !== null;
  }

  /** Importa una tanda mientras haya menos de `target` recetas de la biblioteca. Devuelve cuántas entraron. */
  async importBatch(target: number): Promise<number> {
    if (!this.estimator) return 0;
    const room = target - (await this.repo.countLibrary());
    if (room <= 0) return 0;
    const sampled = await this.library.sample(PER_CALL * SPARE);
    const known = new Set((await this.repo.byIds(sampled.map((d) => libraryRecipeId(d._id)))).map((r) => r.id));
    const docs = sampled.filter((d) => !known.has(libraryRecipeId(d._id))).slice(0, Math.min(PER_CALL, room));
    if (docs.length === 0) return 0;
    const estimated = await this.estimator.estimate(docs);
    let added = 0;
    for (const e of estimated) {
      const doc = docs.find((d) => d._id === e.sourceId);
      if (doc && (await this.save(doc, e))) added++;
    }
    this.log.info({ asked: docs.length, added }, 'recetas de la biblioteca importadas');
    return added;
  }

  private async save(doc: RawRecipeDoc, e: EstimatedRecipe): Promise<boolean> {
    // Si el original declara un alérgeno que se perdió al traducir, la receta no es segura para quien lo evita.
    const translated = new Set(e.ingredients.flatMap((i) => allergensIn(i.label)));
    const lost = allergensIn([...(doc.ingredients ?? []), ...(doc.ner ?? [])].join(' | ')).filter((a) => !translated.has(a));
    if (lost.length) {
      this.log.info({ sourceId: doc._id, lost }, 'receta descartada: la traducción perdió alérgenos');
      return false;
    }
    // Los ingredientes van antes y fuera de la transacción: otro proceso los debe ver antes que la receta.
    const ids = await this.catalog.addTexts(e.ingredients.map((i) => i.label));
    const id = libraryRecipeId(doc._id);
    await this.db.transaction(async (tx) => {
      await this.repo.insert(tx, {
        id,
        authorType: 'noshy',
        status: 'published',
        title: e.title,
        slug: id,
        cuisineId: e.cuisineId,
        cuisineLabel: e.cuisineId ? CUISINES[e.cuisineId]! : null,
        flavorTags: e.flavorTags,
        mealSlots: e.mealSlots,
        timeMin: e.minutes,
        timeMax: e.minutes,
        baseServings: e.servings,
        difficulty: e.difficulty,
        userSteps: e.steps.map((text) => ({ text })),
        nutritionPerServing: e.perServing,
        nutritionStatus: 'estimated',
        chefConsultable: { enabled: true, useMyStyle: false, suggestSubstitutes: true },
        publishedAt: new Date(),
      });
      await this.repo.replaceIngredients(
        tx,
        id,
        e.ingredients.map((i, position) => ({ ingredientId: ids[position]!, value: i.value, unit: i.unit, prep: null, position })),
      );
    });
    return true;
  }
}
