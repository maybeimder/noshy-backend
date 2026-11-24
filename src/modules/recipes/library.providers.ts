import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { RawRecipeDoc } from '../../infrastructure/database/mongo/collections.js';
import type { OpenRouterClient } from '../../infrastructure/ai/openrouter.client.js';
import { CUISINES, DIFFICULTIES, MEAL_SLOTS, type Difficulty, type MealSlotId } from '../../core/domain/catalog.js';
import type { Macros } from '../../core/domain/nutrition.js';

export const FLAVORS = ['creamy', 'spicy', 'fresh', 'sweet', 'comfort', 'umami', 'cheese', 'smoky', 'avocado', 'plantain'] as const;

/** Receta de la biblioteca en español y con macros estimados por porción. */
export type EstimatedRecipe = {
  sourceId: number;
  title: string;
  servings: number;
  minutes: number;
  difficulty: Difficulty;
  mealSlots: MealSlotId[];
  cuisineId: string | null;
  flavorTags: string[];
  ingredients: { label: string; value: number; unit: 'g' | 'ml' | 'unit' }[];
  steps: string[];
  perServing: Macros;
};

export interface RecipeEstimator {
  estimate(recipes: RawRecipeDoc[]): Promise<EstimatedRecipe[]>;
}

const PROMPT = `Eres nutricionista y traductor de recetas para una app colombiana.
Recibes recetas en inglés. Para cada una: tradúcela al español de Colombia, pasa las cantidades a gramos o mililitros y ESTIMA las porciones y los macros POR PORCIÓN.
Calcula los macros sumando los ingredientes y dividiendo por las porciones; kcal debe cuadrar con 4*proteína + 4*carbohidratos + 9*grasa.
Las porciones deben ser realistas (un plato fuerte ronda 350–800 kcal). No quites ni agregues ingredientes.
Responde SOLO JSON:
{"recipes":[{"id":<id recibido>,"title":"...","servings":<n>,"minutes":<total>,"difficulty":"easy|medium|hard","mealSlots":["breakfast|snack1|lunch|snack2|dinner"],"cuisine":"${Object.keys(CUISINES).join('|')}","flavors":["${FLAVORS.join('|')}"],"ingredients":[{"label":"...","value":<n>,"unit":"g|ml|unit"}],"steps":["..."],"perServing":{"kcal":<n>,"proteinG":<n>,"carbsG":<n>,"fatG":<n>}}]}`;

const num = z.coerce.number().finite();
/** Filtra lo que no sea una opción válida en vez de descartar la receta entera. */
const only = <T extends string>(options: readonly T[]) =>
  z
    .array(z.string())
    .catch([])
    .transform((list) => [...new Set(list.filter((x): x is T => (options as readonly string[]).includes(x)))]);

const Item = z.object({
  id: num,
  title: z.string().trim().min(3).max(90),
  servings: num.pipe(z.number().int().min(1).max(16)),
  minutes: num.pipe(z.number().min(3).max(360)),
  difficulty: z.enum(DIFFICULTIES.map((d) => d.id) as [Difficulty, ...Difficulty[]]).catch('medium'),
  mealSlots: only(MEAL_SLOTS),
  cuisine: z.string().catch(''),
  flavors: only(FLAVORS),
  ingredients: z.array(z.object({ label: z.string().trim().min(2).max(60), value: num.pipe(z.number().positive().max(10_000)), unit: z.enum(['g', 'ml', 'unit']) })).min(2).max(20),
  steps: z.array(z.string().trim().min(3).max(600)).min(1).max(20),
  perServing: z.object({ kcal: num, proteinG: num, carbsG: num, fatG: num }),
});

/** Los macros deben ser creíbles y cuadrar con las calorías (±25 %); si no, la estimación no sirve. */
export function credibleMacros(m: Macros): boolean {
  if (m.kcal < 40 || m.kcal > 1_400 || [m.proteinG, m.carbsG, m.fatG].some((x) => x < 0 || x > 250)) return false;
  return Math.abs(4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG - m.kcal) <= m.kcal * 0.25;
}

export function parseEstimates(raw: unknown, ids: number[]): EstimatedRecipe[] {
  const list = z.object({ recipes: z.array(z.unknown()) }).safeParse(raw);
  if (!list.success) return [];
  return list.data.recipes.flatMap((r) => {
    const p = Item.safeParse(r);
    if (!p.success || !ids.includes(p.data.id) || !credibleMacros(p.data.perServing)) return [];
    const { id, cuisine, flavors, perServing, minutes, mealSlots, ...rest } = p.data;
    const round = Math.round;
    return [
      {
        ...rest,
        sourceId: id,
        minutes: round(minutes),
        mealSlots: mealSlots.length ? mealSlots : (['lunch', 'dinner'] as MealSlotId[]),
        cuisineId: cuisine in CUISINES ? cuisine : null,
        flavorTags: flavors,
        perServing: { kcal: round(perServing.kcal), proteinG: round(perServing.proteinG), carbsG: round(perServing.carbsG), fatG: round(perServing.fatG) },
      },
    ];
  });
}

export class LlmRecipeEstimator implements RecipeEstimator {
  constructor(
    private readonly llm: OpenRouterClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  async estimate(recipes: RawRecipeDoc[]): Promise<EstimatedRecipe[]> {
    const input = recipes.map((r) => ({ id: r._id, title: r.title, ingredients: r.ingredients ?? [], directions: r.directions ?? [] }));
    const out = parseEstimates(await this.llm.chatJson([{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(input) }], 0.2), recipes.map((r) => r._id));
    if (out.length < recipes.length) this.log.info({ asked: recipes.length, valid: out.length }, 'estimaciones de recetas descartadas');
    return out;
  }
}
