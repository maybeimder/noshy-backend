import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { RecipesRepository } from './recipes.repository.js';
import type { RecipeLibraryRepository } from './library.repository.js';
import type { RecipePhotosService } from './recipe-photos.service.js';
import { estimateRaw, type RawEstimate } from './raw-estimator.js';
import { rawIngredientId, rawIngredientRow } from './raw-foods.js';

/** Recetas del recetario que cada persona debería poder ver en «Explorar». */
export const EXPLORE_TARGET = 60;
/** Tope para todos: cada una se evalúa en memoria al explorar. */
export const LIBRARY_MAX = 600;
const SAMPLE = 400;
const MAX_ROUNDS = 8;
const PAUSE_MS = 10 * 60_000;
/** Lo que espera la primera visita a que aparezcan; si tarda más, sigue en segundo plano. */
const FIRST_WAIT_MS = 4_000;

/** Dice si algo con esos alérgenos y banderas choca con la persona. */
export type Avoid = (f: { allergens: string[]; dietFlags: string[] }) => boolean;

/** Prefijo propio: solo salen en «Explorar», no en Inicio ni en el menú (están en inglés). */
export const RAW_PREFIX = 'rcp_raw_';
export const libraryRecipeId = (sourceId: number) => `${RAW_PREFIX}${sourceId}`;

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const factsOf = (e: RawEstimate) => ({ allergens: e.ingredients.flatMap((i) => i.food.allergens), dietFlags: e.ingredients.flatMap((i) => i.food.diet) });

type Entry = { id: string; estimate: RawEstimate };

/**
 * Recetario: recetas de `recipes_raw` tal cual (en inglés), con macros ESTIMADOS por tabla (`raw-estimator`), sin modelo.
 * Solo entran las que se entienden completas. Quedan guardadas como recetas normales.
 */
export class RecipeLibraryService {
  private filling: Promise<number> | null = null;
  private pausedUntil = 0;

  constructor(
    private readonly db: Db,
    private readonly library: RecipeLibraryRepository,
    private readonly repo: RecipesRepository,
    private readonly catalog: CatalogService,
    private readonly photos: RecipePhotosService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Al abrir «Explorar»: si la persona ve menos de `EXPLORE_TARGET`, trae más que SÍ pueda comer. Espera un momento para
   * que salgan de una vez. `paused`: no hubo suficientes (o Mongo falló) y se reintenta en un rato.
   */
  async fillForExplore(visible: number, avoid: Avoid, now = Date.now()): Promise<'ready' | 'filling' | 'paused'> {
    if (visible >= EXPLORE_TARGET) return 'ready';
    if (!this.filling) {
      if (now < this.pausedUntil) return 'paused';
      this.filling = this.fill(EXPLORE_TARGET - visible, avoid, now).finally(() => (this.filling = null));
    }
    const done = await Promise.race([this.filling.then(() => true), new Promise<false>((r) => setTimeout(r, FIRST_WAIT_MS, false))]);
    return !done ? 'filling' : now < this.pausedUntil ? 'paused' : 'ready';
  }

  private async fill(wanted: number, avoid: Avoid, now: number): Promise<number> {
    let added = 0;
    try {
      const titles = new Set((await this.repo.rawTitles()).map(normTitle));
      let room = LIBRARY_MAX - titles.size;
      for (let round = 0; round < MAX_ROUNDS && added < wanted && room > 0; round++) {
        const docs = await this.library.sample(SAMPLE);
        const fresh = await this.estimate(docs, avoid, titles, Math.min(wanted - added, room));
        const n = await this.save(fresh);
        added += n;
        room -= n;
      }
    } catch (err) {
      this.log.warn({ err }, 'recetario: no se pudo traer de recipes_raw');
    }
    if (added < wanted) this.pausedUntil = now + PAUSE_MS;
    this.log.info({ added, wanted }, 'recetario: explorar');
    return added;
  }

  private async estimate(docs: RawRecipeDoc[], avoid: Avoid, titles: Set<string>, limit: number): Promise<Entry[]> {
    const out: Entry[] = [];
    for (const [n, d] of docs.entries()) {
      if (out.length >= limit) break;
      // Es trabajo de CPU: se cede el turno para no frenar a los demás.
      if (n % 20 === 19) await new Promise((r) => setImmediate(r));
      const id = libraryRecipeId(d._id);
      const title = normTitle(d.title ?? '');
      if (titles.has(title)) continue;
      const estimate = estimateRaw(d);
      if (!estimate || avoid(factsOf(estimate))) continue;
      titles.add(title);
      out.push({ id, estimate });
    }
    return out;
  }

  /** Guarda las que falten. Los ingredientes van antes: otro proceso los debe ver antes que la receta. */
  private async save(entries: Entry[]): Promise<number> {
    if (entries.length === 0) return 0;
    await this.catalog.addRows(entries.flatMap(({ estimate }) => estimate.ingredients.map((i) => rawIngredientRow(i.food, i.label))));
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const inserted = await this.repo.insertMissing(
        tx,
        entries.map(({ id, estimate: e }) => ({
          id,
          authorType: 'noshy',
          status: 'published',
          title: e.title,
          slug: id,
          imageUrl: this.photos.url({ id, title: e.title }, e.ingredients.map((i) => rawIngredientId(i.food.key, i.label))),
          mealSlots: e.mealSlots,
          timeMin: e.minutes,
          timeMax: e.minutes,
          baseServings: e.servings,
          difficulty: e.difficulty,
          userSteps: e.steps.map((text) => ({ text: text.slice(0, 1000) })),
          nutritionPerServing: e.perServing,
          nutritionStatus: 'estimated',
          chefConsultable: { enabled: true, useMyStyle: false, suggestSubstitutes: true },
          publishedAt: now,
        })),
      );
      for (const { id, estimate } of entries.filter((x) => inserted.has(x.id))) {
        await this.repo.replaceIngredients(
          tx,
          id,
          estimate.ingredients.map((i, position) => ({ ingredientId: rawIngredientId(i.food.key, i.label), value: i.value, unit: i.unit, prep: null, position })),
        );
      }
      return inserted.size;
    });
  }
}
