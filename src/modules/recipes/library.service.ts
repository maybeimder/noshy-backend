import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { allergensIn, factsIn } from '../catalog/food-ingredient.js';
import type { RecipesRepository } from './recipes.repository.js';
import type { RecipeLibraryRepository } from './library.repository.js';
import type { EstimatedRecipe, RecipeEstimator } from './library.providers.js';
import { CUISINES } from '../../core/domain/catalog.js';

/** Opciones por pedido, y por llamada al modelo. */
export const MAX_OPTIONS = 2;
const SPARE = 3;
const SEARCH_POOL = 60;

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const rawText = (d: RawRecipeDoc) => [...(d.ingredients ?? []), ...(d.ner ?? [])].join(' | ');
export const libraryRecipeId = (sourceId: number) => `rcp_lib_${sourceId}`;

/**
 * Genera recetas a partir de `recipes_raw`, cuando alguien las pide, con macros ESTIMADOS por un modelo. Cada una se
 * estima una sola vez: queda guardada y la puede ver cualquiera sin gastar otra llamada. No se cruzan sus ingredientes
 * con el catálogo: son texto, y sirven para mostrarlos y detectar alérgenos.
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

  /**
   * Hasta dos opciones distintas con esos ingredientes (en inglés). `avoid` descarta, antes de gastar una llamada, lo
   * que choca con la persona. Devuelve ids de recetas.
   */
  async forRequest(opts: { ingredients: string[]; avoid: (f: { allergens: string[]; dietFlags: string[] }) => boolean; excludeRecipeIds: string[] }): Promise<string[]> {
    if (!this.estimator) return [];
    const terms = [...new Set(opts.ingredients.map((t) => t.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/ +/g, ' ').trim()).filter((t) => t.length > 1))].slice(0, 5);
    if (terms.length === 0) return [];
    const titles = new Set<string>();
    const docs = (await this.library.search(terms, SEARCH_POOL)).filter((d) => {
      const title = normTitle(d.title);
      if (titles.has(title) || opts.excludeRecipeIds.includes(libraryRecipeId(d._id)) || opts.avoid(factsIn(rawText(d)))) return false;
      titles.add(title);
      return true;
    });
    const known = new Set((await this.repo.byIds(docs.map((d) => libraryRecipeId(d._id)))).map((r) => r.id));
    // Las ya estimadas primero: no cuestan nada.
    const picked = [...docs.filter((d) => known.has(libraryRecipeId(d._id))), ...docs.filter((d) => !known.has(libraryRecipeId(d._id)))].slice(0, MAX_OPTIONS);
    const fresh = picked.filter((d) => !known.has(libraryRecipeId(d._id)));
    if (fresh.length) {
      const estimated = await this.estimator.estimate(fresh).catch((err: unknown) => {
        this.log.warn({ err }, 'no se pudieron estimar recetas');
        return [];
      });
      for (const e of estimated) {
        const doc = fresh.find((d) => d._id === e.sourceId);
        if (doc && (await this.save(doc, e))) known.add(libraryRecipeId(doc._id));
      }
      this.log.info({ terms, asked: fresh.length, generated: estimated.length }, 'recetas generadas para un pedido');
    }
    return picked.map((d) => libraryRecipeId(d._id)).filter((id) => known.has(id));
  }

  /** Importa una tanda mientras haya menos de `target` recetas de la biblioteca. Devuelve cuántas entraron. */
  async importBatch(target: number): Promise<number> {
    if (!this.estimator) return 0;
    const room = target - (await this.repo.countLibrary());
    if (room <= 0) return 0;
    const sampled = await this.library.sample(MAX_OPTIONS * SPARE);
    const known = new Set((await this.repo.byIds(sampled.map((d) => libraryRecipeId(d._id)))).map((r) => r.id));
    const docs = sampled.filter((d) => !known.has(libraryRecipeId(d._id))).slice(0, Math.min(MAX_OPTIONS, room));
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
    const lost = allergensIn(rawText(doc)).filter((a) => !translated.has(a));
    if (lost.length) {
      this.log.info({ sourceId: doc._id, lost }, 'receta descartada: la traducción perdió alérgenos');
      return false;
    }
    // Los ingredientes van antes y fuera de la transacción: otro proceso los debe ver antes que la receta.
    const ids = await this.catalog.addTexts(e.ingredients.map((i) => i.label));
    const id = libraryRecipeId(doc._id);
    // Otra persona pudo pedir la misma a la vez.
    if (await this.repo.byId(id)) return true;
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
