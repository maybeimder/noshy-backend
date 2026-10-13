import { z } from 'zod';
import { RECIPE_MEAL_TYPES, type RecipeWriterContext, type RecipeWriterPort, type WrittenRecipe } from '../../modules/food/recipe-writer.port';
import { extractJson, OpenRouterClient, type OpenRouterOptions } from './openrouter.client';

const TRANSLATE_PROMPT = `Traduces nombres de ingredientes del español al inglés para buscarlos en el dataset RecipeNLG (campo "ner").
Usa el nombre común más simple, en minúsculas y singular cuando el dataset lo use así ("chicken", "rice", "onion", "black beans").
Sin cantidades, marcas ni adjetivos innecesarios. Responde SOLO con JSON: {"ingredients": ["...", ...]} en el MISMO orden y con la MISMA cantidad que la entrada.`;

const WRITER_PROMPT = `Eres el redactor de recetas de Noshy, una app de nutrición escolar. Escribes en español, claro y breve.
Recibes los ingredientes del usuario y recetas de referencia en inglés (RecipeNLG): úsalas solo como inspiración, adapta y traduce.
Reglas:
- Usa los ingredientes del usuario. Respeta sus gramos si los dio y conserva su "foodId" tal cual.
- Puedes añadir pocos básicos (sal, aceite, agua, especias) sin foodId.
- Cada ingrediente lleva "grams" (número, en gramos, crudo salvo que se diga lo contrario).
- Respeta las restricciones del plan nutricional si las hay.
- NO calcules calorías ni macros.
- "mealType" es uno de: desayuno, almuerzo, cena, merienda, postre, bebida.
Responde SOLO con JSON:
{"title": "...", "servings": <número>, "mealType": "...", "ingredients": [{"name": "...", "grams": <número>, "foodId": "<opcional>"}], "steps": ["..."], "notes": "<opcional>"}`;

const translationSchema = z.object({ ingredients: z.array(z.string().trim().min(1)) });

const writtenRecipeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  servings: z.coerce.number().int().min(1).max(24),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        grams: z.coerce.number().positive().max(10_000),
        foodId: z.string().trim().min(1).max(64).optional().nullable()
      })
    )
    .min(1)
    .max(30),
  steps: z.array(z.string().trim().min(1)).min(1).max(30),
  notes: z.string().trim().max(600).optional().nullable(),
  // Un tipo inventado por el modelo se descarta en vez de invalidar la receta.
  mealType: z.enum(RECIPE_MEAL_TYPES).optional().catch(undefined)
});

function describeReferences(context: RecipeWriterContext): string {
  if (context.references.length === 0) return 'Recetas de referencia: ninguna.';
  return context.references
    .map((recipe, index) =>
      [
        `Referencia ${index + 1}: ${recipe.title}`,
        `Ingredientes: ${recipe.ingredients.slice(0, 20).join('; ')}`,
        `Pasos: ${recipe.directions.slice(0, 10).join(' ').slice(0, 1200)}`
      ].join('\n')
    )
    .join('\n\n');
}

function describeRequest(context: RecipeWriterContext): string {
  const plan = context.nutritionPlan
    ? `Plan nutricional: ${JSON.stringify({ objetivo: context.nutritionPlan.objective, restricciones: context.nutritionPlan.restrictions })}`
    : 'Plan nutricional: ninguno.';
  return [
    `Ingredientes del usuario: ${JSON.stringify(context.ingredients)}`,
    `Porciones: ${context.servings}`,
    context.notes ? `Indicaciones del usuario: ${context.notes}` : '',
    plan
  ]
    .filter(Boolean)
    .join('\n');
}

// Adaptador del puerto RecipeWriterPort contra OpenRouter (modelos gratuitos).
export class OpenRouterRecipeWriter implements RecipeWriterPort {
  private readonly client: OpenRouterClient;

  constructor(options: OpenRouterOptions) {
    this.client = new OpenRouterClient(options);
  }

  async translateIngredients(names: string[]): Promise<string[]> {
    const content = await this.client.chatJson(
      [
        { role: 'system', content: TRANSLATE_PROMPT },
        { role: 'user', content: JSON.stringify({ ingredients: names }) }
      ],
      0
    );
    const { ingredients } = translationSchema.parse(extractJson(content));
    if (ingredients.length !== names.length) {
      throw new Error('La traducción no devolvió un ingrediente por cada entrada.');
    }
    return ingredients.map((name) => name.toLowerCase());
  }

  async writeRecipe(context: RecipeWriterContext): Promise<WrittenRecipe> {
    const content = await this.client.chatJson(
      [
        { role: 'system', content: WRITER_PROMPT },
        { role: 'system', content: describeReferences(context) },
        { role: 'user', content: describeRequest(context) }
      ],
      0.5
    );
    const recipe = writtenRecipeSchema.parse(extractJson(content));
    return {
      title: recipe.title,
      servings: recipe.servings,
      ingredients: recipe.ingredients.map(({ name, grams, foodId }) => ({ name, grams, ...(foodId ? { foodId } : {}) })),
      steps: recipe.steps,
      ...(recipe.notes ? { notes: recipe.notes } : {}),
      ...(recipe.mealType ? { mealType: recipe.mealType } : {})
    };
  }
}
