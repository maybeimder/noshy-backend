import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import type { PreferencesRow } from '../onboarding/preferences.repository.js';
import type { RecipesRepository } from './recipes.repository.js';
import type { RecipePhotosService } from './recipe-photos.service.js';
import { factsIn } from '../catalog/food-ingredient.js';
import { normalizeText, stem } from '../catalog/food-text.js';
import { MEAL_SLOTS } from '../../core/domain/catalog.js';
import { recipeNutrition, type Macros } from '../../core/domain/nutrition.js';
import { UNITS, type Unit } from '../../core/domain/quantity.js';
import { ulid } from 'ulid';

/** Recetas que el chef puede crear por mensaje. */
export const MAX_GENERATED = 2;

const number = z.coerce.number().refine((n) => Number.isFinite(n) && n >= 0);
const text = (max: number) => z.string().trim().min(1).transform((s) => s.replace(/\s+/g, ' ').slice(0, max));
const optional = <T extends z.ZodType>(s: T) => s.nullish().catch(null);

/** Lo que se le pide al modelo. Lo accesorio puede venir mal sin tumbar la receta; lo esencial, no. */
const Draft = z.object({
  title: text(90).refine((s) => s.length >= 3),
  dish: optional(text(60)),
  servings: z.coerce.number().int().min(1).max(12).catch(2),
  minutes: z.coerce.number().min(3).max(480).transform(Math.round).catch(30),
  difficulty: z.enum(['easy', 'medium', 'hard']).catch('easy'),
  mealSlots: z.array(z.string()).catch([]).transform((l) => MEAL_SLOTS.filter((s) => l.includes(s))),
  ingredients: z
    .array(z.object({ name: text(60).refine((s) => s.length >= 2), value: optional(number), unit: optional(z.string()), grams: optional(number) }))
    .min(2)
    .max(20),
  steps: z
    .array(z.object({ text: text(600), minutes: optional(number), ingredients: z.array(z.string()).catch([]) }))
    .min(1)
    .max(15),
  perServing: optional(z.object({ kcal: number, proteinG: number, carbsG: number, fatG: number })),
});
type Draft = z.infer<typeof Draft>;

/** Los modelos traducen las unidades aunque se les pida el código. */
const UNIT_ALIASES: Record<string, Unit> = {
  gramos: 'g', gramo: 'g', gr: 'g', kilo: 'kg', kilos: 'kg', mililitros: 'ml', litro: 'l', litros: 'l', unidad: 'unit', unidades: 'unit', und: 'unit', diente: 'clove', dientes: 'clove',
  cucharada: 'tbsp', cucharadas: 'tbsp', cda: 'tbsp', cdas: 'tbsp', cucharadita: 'tsp', cucharaditas: 'tsp', cdta: 'tsp', cdtas: 'tsp', taza: 'cup', tazas: 'cup', pizca: 'pinch', pizcas: 'pinch', 'al gusto': 'toTaste', totaste: 'toTaste',
};
const unitOf = (u: string | null | undefined): Unit | null => {
  const key = normalizeText(u ?? '').trim();
  return UNITS.find((x) => x.toLowerCase() === key) ?? UNIT_ALIASES[key] ?? null;
};

const CONNECTORS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'al', 'para']);
const stems = (s: string) => normalizeText(s).split(/[^a-z0-9]+/).filter((w) => w && !CONNECTORS.has(w)).map(stem);
/** Mismo nombre sin importar plural, orden ni conectores. «Leche» y «leche de coco» NO son lo mismo. */
const nameKey = (s: string) => [...new Set(stems(s))].sort().join(' ');

type Resolved = { ingredientId: string; value: number | null; unit: Unit; grams: number | null; name: string };

/**
 * Recetas que inventa el chef para una persona. El modelo entrega JSON; aquí se valida, se lleva al catálogo, se revisa contra
 * sus alergias y dieta (sin confiar en el modelo) y se guarda como receta normal, privada: solo la ve su dueño.
 */
export class GeneratedRecipesService {
  constructor(
    private readonly db: Db,
    private readonly repo: RecipesRepository,
    private readonly catalog: CatalogService,
    private readonly preferences: PreferencesService,
    private readonly photos: RecipePhotosService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Ids de las que quedaron bien. Las demás se descartan (y se anota por qué). */
  async create(userId: string, prefs: PreferencesRow, pantryIds: Iterable<string>, drafts: unknown[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of drafts.slice(0, MAX_GENERATED)) {
      const parsed = Draft.safeParse(raw);
      if (!parsed.success) {
        this.log.warn({ issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }, 'chef: receta mal formada');
        continue;
      }
      const result = await this.save(userId, prefs, pantryIds, parsed.data);
      if ('id' in result) ids.push(result.id);
      else this.log.warn({ title: parsed.data.title, reason: result.rejected }, 'chef: receta descartada');
    }
    return ids;
  }

  private async save(userId: string, prefs: PreferencesRow, pantryIds: Iterable<string>, d: Draft): Promise<{ id: string } | { rejected: string }> {
    const clash = this.clash(prefs, d);
    if (clash) return { rejected: clash };
    const ingredients = await this.resolve(d, pantryIds);
    for (const i of ingredients) {
      const c = this.preferences.conflictsForFacts(prefs, this.catalog.facts(i.ingredientId))[0];
      if (c) return { rejected: `${i.name}: ${c.label}` };
    }
    const nutrition = this.nutrition(d, ingredients);
    if (!nutrition) return { rejected: 'sin calorías creíbles' };

    const id = `rcp_ai_${ulid()}`;
    const byName = new Map(ingredients.map((i) => [nameKey(i.name), i.ingredientId]));
    await this.db.transaction(async (tx) => {
      await this.repo.insert(tx, {
        id,
        authorType: 'chef',
        authorId: userId,
        status: 'private',
        title: d.title,
        slug: id,
        imageUrl: this.photos.url({ id, title: [d.title, d.dish].filter(Boolean).join(' · ') }, ingredients.map((i) => i.ingredientId)),
        mealSlots: d.mealSlots.length ? d.mealSlots : ['lunch', 'dinner'],
        timeMin: d.minutes,
        timeMax: d.minutes,
        baseServings: d.servings,
        difficulty: d.difficulty,
        userSteps: d.steps.map((s) => {
          const ingredientIds = [...new Set(s.ingredients.flatMap((n) => byName.get(nameKey(n)) ?? []))];
          return { text: s.text, ...(s.minutes ? { timerSeconds: Math.round(Math.min(s.minutes, 480) * 60) } : {}), ...(ingredientIds.length ? { ingredientIds } : {}) };
        }),
        nutritionPerServing: nutrition.perServing,
        nutritionStatus: nutrition.status,
        chefConsultable: { enabled: true, useMyStyle: false, suggestSubstitutes: true },
      });
      await this.repo.replaceIngredients(tx, id, ingredients.map((i, position) => ({ ingredientId: i.ingredientId, value: i.value, unit: i.unit, prep: null, position })));
    });
    return { id };
  }

  /** Algo que no puede o no quiere comer, en cualquier parte: título, ingredientes o pasos. */
  private clash(prefs: PreferencesRow, d: Draft): string | null {
    const names = new Set(d.ingredients.flatMap((i) => stems(i.name)));
    // Lo que nombran los ingredientes se revisa ingrediente por ingrediente («leche» en un paso puede ser la de coco de la lista).
    const loose = [d.title, ...d.steps.map((s) => s.text)].join(' . ').replace(/[\p{L}\p{N}]+/gu, (w) => (names.has(stem(normalizeText(w))) ? ' ' : w));
    const c = this.preferences.conflictsForFacts(prefs, { id: '', label: '', ...factsIn(loose) })[0];
    if (c) return `menciona ${c.label}`;
    const all = new Set(stems([d.title, ...d.ingredients.map((i) => i.name), ...d.steps.map((s) => s.text)].join(' ')));
    const excluded = prefs.restrictions.customExclusions.find((x) => {
      const parts = stems(x);
      return parts.length > 0 && parts.every((p) => all.has(p));
    });
    return excluded ? `lleva ${excluded}` : null;
  }

  /** Cada ingrediente: el que ya tiene en la despensa si se llama igual, el base de Noshy, o uno nuevo con ese texto. */
  private async resolve(d: Draft, pantryIds: Iterable<string>): Promise<Resolved[]> {
    const mine = [...pantryIds].filter((id) => this.catalog.hasIngredient(id));
    const base = this.catalog.search('', 5000).map((i) => i.id);
    const known = new Map([...base, ...mine].map((id) => [nameKey(this.catalog.label(id)), id]));
    const out: Resolved[] = [];
    for (const i of d.ingredients) {
      const ingredientId = known.get(nameKey(i.name)) ?? (await this.catalog.ensureText(i.name));
      const unit = unitOf(i.unit);
      const toTaste = unit === 'toTaste' || unit === 'all' || (!i.value && !i.grams);
      const row: Resolved = toTaste
        ? { ingredientId, value: null, unit: 'toTaste', grams: 0, name: i.name }
        : i.value && unit
          ? { ingredientId, value: i.value, unit, grams: this.catalog.grams(ingredientId, i.value, unit) ?? i.grams ?? null, name: i.name }
          : // Sin unidad clara, lo único seguro son los gramos.
            { ingredientId, value: i.grams || i.value!, unit: i.grams ? 'g' : 'unit', grams: i.grams || this.catalog.grams(ingredientId, i.value!, 'unit'), name: i.name };
      const same = out.find((x) => x.ingredientId === ingredientId);
      if (!same) out.push(row);
      else if (same.unit === row.unit && same.value !== null && row.value !== null) {
        same.value += row.value;
        same.grams = same.grams === null || row.grams === null ? null : same.grams + row.grams;
      }
    }
    return out;
  }

  /** Sumadas del catálogo si se conocen todos; si no, las del modelo, siempre que cuadren. */
  private nutrition(d: Draft, ingredients: Resolved[]): { perServing: Macros; status: 'calculated' | 'estimated' } | null {
    const own = recipeNutrition(ingredients.map((i) => ({ value: i.value, unit: i.unit, nutrition: this.catalog.nutrition(i.ingredientId) })), d.servings);
    const ok = (m: Macros) => m.kcal >= 30 && m.kcal <= 1_800;
    if (own.status === 'calculated' && ok(own.perServing)) return { perServing: own.perServing, status: 'calculated' };
    if (!d.perServing) return null;
    const { proteinG, carbsG, fatG, kcal } = d.perServing;
    const fromMacros = 4 * proteinG + 4 * carbsG + 9 * fatG;
    if (fromMacros <= 0) return null;
    // Si las calorías no cuadran con los macros, mandan los macros.
    const perServing = { kcal: Math.round(Math.abs(kcal - fromMacros) / fromMacros > 0.25 ? fromMacros : kcal), proteinG: Math.round(proteinG), carbsG: Math.round(carbsG), fatG: Math.round(fatG) };
    return ok(perServing) ? { perServing, status: 'estimated' } : null;
  }
}
