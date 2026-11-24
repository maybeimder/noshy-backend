import type { ChefBlock, ChefMessageDoc, ChefThreadDoc } from '../../infrastructure/database/mongo/collections.js';
import type { RecipeCard } from '../recipes/recipes.service.js';

/**
 * Motor de respuestas del chef. El servicio le da contexto y herramientas; el motor decide
 * qué responder y lo entrega en trozos (texto que se va escribiendo o bloques completos).
 * `RuleBasedChefEngine` cubre los flujos del diseño de forma determinista; un motor con LLM
 * puede reemplazarlo implementando la misma interfaz.
 */
export type ChefInputResolved =
  | { kind: 'text'; text: string }
  | { kind: 'quickReply'; optionId: string; label: string }
  | { kind: 'suggestedPrompt'; optionId: string; label: string }
  | { kind: 'anotherIdea'; recipeId: string | null };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type BlockDraft = DistributiveOmit<ChefBlock, 'id'> & { id?: string };
export type ChefChunk = { type: 'text'; delta: string } | { type: 'block'; block: BlockDraft } | { type: 'recipes'; recipeIds: string[] };

export type ChefTools = {
  /** Varias candidatas para que un modelo elija (ya filtradas por restricciones). */
  candidates(opts: { excludeRecipeIds: string[]; limit: number }): Promise<RecipeCard[]>;
  preferencesSummary(): string;
  recommend(opts: { excludeRecipeIds: string[]; prefer?: 'hearty' | 'protein' | 'quick'; recipeIdsHint?: string[] }): Promise<RecipeCard | null>;
  missingFromShoppingList(): Promise<string[]>;
  topInsight(): Promise<{ id: string; text: string } | null>;
  recipe(recipeId: string): Promise<{ id: string; title: string; hasHighHeatStep: number | null } | null>;
  proposeAdaptation(recipeId: string, kind: 'airfryer', summary: string, changes: string[], stepNotes: { stepIndex: number; text: string }[]): Promise<string>;
  hasEquipment(id: string): boolean;
  /** Ingredientes, macros y pasos de una receta, en texto. */
  recipeBrief(recipeId: string): Promise<string | null>;
  /** Hasta 2 recetas nuevas con esos ingredientes (en inglés), compatibles con la persona. null = no disponible. */
  newRecipes: ((opts: { ingredients: string[]; excludeRecipeIds: string[] }) => Promise<RecipeCard[]>) | null;
};

export type ChefTurn = {
  userName: string;
  thread: ChefThreadDoc;
  input: ChefInputResolved;
  shownRecipeIds: string[];
  lastChefMessage: ChefMessageDoc | null;
  /** Lo último que se dijeron, del más viejo al más nuevo (sin el mensaje actual). */
  history: { role: 'user' | 'chef'; text: string }[];
};

export interface ChefEngine {
  reply(turn: ChefTurn, tools: ChefTools): AsyncIterable<ChefChunk>;
}

const words = (text: string) => text.match(/\S+\s*/g) ?? [text];
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

export class RuleBasedChefEngine implements ChefEngine {
  async *reply(turn: ChefTurn, tools: ChefTools): AsyncIterable<ChefChunk> {
    const say = function* (text: string): Generator<ChefChunk> {
      for (const w of words(text)) yield { type: 'text', delta: w };
    };
    const input = turn.input;
    const text = input.kind === 'text' ? norm(input.text) : input.kind === 'anotherIdea' ? 'otra idea' : norm(input.label);
    const recipeThread = turn.thread.context.type === 'recipe' ? turn.thread.context : null;

    // Dudas dentro de una receta
    if (recipeThread) {
      const recipe = await tools.recipe(recipeThread.recipeId);
      if (recipe && /air ?fryer|freidora de aire/.test(text)) {
        const stepIndex = recipe.hasHighHeatStep;
        if (!tools.hasEquipment('airfryer')) yield* say('No tienes airfryer en tu cocina, pero si consigues una, así quedaría: ');
        yield* say(`Sí. El pollo queda dorado en airfryer a 200 °C por 12 minutos, volteándolo a la mitad, y usas menos aceite.`);
        const proposalId = await tools.proposeAdaptation(
          recipe.id,
          'airfryer',
          'Versión airfryer',
          ['El pollo se dora en airfryer a 200 °C, 12 min', 'Aceite: 1 cda en vez de 2'],
          stepIndex !== null ? [{ stepIndex, text: 'Si usas airfryer: 200 °C por 12 minutos, volteando a la mitad.' }] : [],
        );
        yield { type: 'block', block: { type: 'adaptationProposal', proposalId, recipeId: recipe.id, summary: 'Versión airfryer', changes: ['El pollo se dora en airfryer a 200 °C, 12 min', 'Aceite: 1 cda en vez de 2'] } };
        return;
      }
      if (recipe && /congel/.test(text)) {
        yield* say(`Sí, ${recipe.title.toLowerCase()} aguanta hasta 3 meses congelada en un recipiente hermético. Descongélala en la nevera la noche anterior.`);
        return;
      }
      yield* say(`Sobre ${recipe?.title ?? 'esta receta'}: dime qué te falta o qué quieres cambiar y te propongo una versión que funcione con lo que tienes.`);
      yield { type: 'block', block: { type: 'suggestedPrompts', options: [{ id: 'sp_airfryer', label: '¿Puedo hacerla en airfryer?' }, { id: 'sp_freeze', label: '¿Se puede congelar?' }] } };
      return;
    }

    // ¿Qué compro?
    if (/compr/.test(text) || (input.kind === 'suggestedPrompt' && input.optionId === 'sp_whattobuy')) {
      const missing = await tools.missingFromShoppingList();
      if (missing.length === 0) {
        yield* say('Tu lista de compras está al día. ¿Te armo algo con lo que ya tienes?');
      } else {
        const head = missing.slice(0, 4).join(', ').toLowerCase();
        yield* say(`En tu lista te faltan ${missing.length} cosas para esta semana: ${head}${missing.length > 4 ? ' y más' : ''}. ¿Te armo algo con lo que ya tienes mientras tanto?`);
      }
      yield { type: 'block', block: { type: 'quickReplies', options: [{ id: 'qr_pantry', label: 'Sí, con lo que tengo' }] } };
      return;
    }

    let prefer: 'hearty' | 'protein' | 'quick' | undefined;
    let intro = '¡Va! Esta te va a gustar:';
    if (input.kind === 'anotherIdea') intro = 'Va, otra opción con lo que tienes:';
    else if (/protein/.test(text)) {
      prefer = 'protein';
      intro = 'Con más proteína, esta es la que más te conviene hoy:';
    } else if (/lactosa/.test(text)) intro = 'Todo lo que te propongo ya viene sin lactosa. Mira esta:';
    else if (/llene|hambre|contundente/.test(text)) {
      prefer = 'hearty';
      intro = 'Algo que llene y no te tome toda la tarde:';
    } else if (/rapid|poco tiempo|afan/.test(text)) {
      prefer = 'quick';
      intro = 'Rapidito, como te gusta:';
    } else if (input.kind === 'text' && !/idea|receta|cocin|comer|almuerzo|cena|desayuno|algo|si\b|sí/.test(text)) {
      yield* say(`Puedo ayudarte con ideas de qué cocinar, tu lista de compras o dudas de una receta, ${turn.userName}. ¿Qué se te antoja?`);
      yield { type: 'block', block: { type: 'suggestedPrompts', options: [{ id: 'sp_idea', label: 'Dame una idea' }, { id: 'sp_whattobuy', label: '¿Qué compro?' }, { id: 'sp_moreprotein', label: 'Más proteína' }] } };
      return;
    }

    const card = await tools.recommend({ excludeRecipeIds: turn.shownRecipeIds, prefer });
    if (!card) {
      yield* say('Ya te mostré todo lo que encaja con tus gustos hoy. ¿Quieres que busquemos en la comunidad?');
      return;
    }
    yield* say(intro);
    yield { type: 'recipes', recipeIds: [card.id] };
    yield { type: 'block', block: { id: 'b_card', type: 'recipeCard', recipe: { ...card, reasonLabel: 'Para ti' } as unknown as Record<string, unknown>, actions: ['save', 'addToShoppingList', 'cook'] } };
    yield { type: 'block', block: { type: 'feedbackPrompt', targetBlockId: 'b_card', label: '¿Te late esta idea?', allowAnotherIdea: true } };
    const insight = await tools.topInsight();
    if (insight && input.kind !== 'anotherIdea') yield { type: 'block', block: { type: 'learnedInsight', insightId: insight.id, text: `Aprendí: ${insight.text.charAt(0).toLowerCase()}${insight.text.slice(1)}` } };
    yield {
      type: 'block',
      block: { type: 'suggestedPrompts', options: [{ id: 'sp_lactosefree', label: 'Sin lactosa' }, { id: 'sp_whattobuy', label: '¿Qué compro?' }, { id: 'sp_moreprotein', label: 'Más proteína' }] },
    };
  }
}

import type { FastifyBaseLogger } from 'fastify';
import type { OpenRouterClient } from '../../infrastructure/ai/openrouter.client.js';

/** Chips con respuesta fija: datos exactos que no hace falta inventar. */
const FIXED_OPTIONS = new Set(['sp_whattobuy', 'sp_airfryer']);
const RECIPE_PROMPTS = [{ id: 'sp_airfryer', label: '¿Puedo hacerla en airfryer?' }, { id: 'sp_freeze', label: '¿Se puede congelar?' }];
const MAIN_PROMPTS = [{ id: 'sp_lactosefree', label: 'Sin lactosa' }, { id: 'sp_whattobuy', label: '¿Qué compro?' }, { id: 'sp_moreprotein', label: 'Más proteína' }];

/**
 * Motor con LLM (OpenRouter). Responde texto libre y chips, con la conversación a la vista: en el hilo principal elige
 * entre candidatas reales; en el de una receta, responde dudas con sus ingredientes, macros y pasos.
 * «Otra idea», «¿Qué compro?» y la versión airfryer (que crea una propuesta) siguen en reglas.
 * Si el modelo falla o responde mal, cae al motor de reglas.
 */
export class LlmChefEngine implements ChefEngine {
  constructor(
    private readonly llm: OpenRouterClient,
    private readonly fallback: ChefEngine,
    private readonly log: FastifyBaseLogger,
  ) {}

  async *reply(turn: ChefTurn, tools: ChefTools): AsyncIterable<ChefChunk> {
    const { input } = turn;
    const text = input.kind === 'text' ? input.text : input.kind === 'anotherIdea' || FIXED_OPTIONS.has(input.optionId) ? null : input.label;
    if (!text || /air ?fryer|freidora de aire|^\W*qu[eé] (?:me falta )?(?:compro|comprar)\W*$/i.test(text)) {
      yield* this.fallback.reply(turn, tools);
      return;
    }
    const context = turn.thread.context;
    let reply: string;
    let cards: RecipeCard[] = [];
    let wanted: string[] = [];
    try {
      if (context.type === 'recipe') reply = (await this.ask(turn, tools, text, RECIPE_SYSTEM, `Receta:\n${(await tools.recipeBrief(context.recipeId)) ?? context.title}`)).reply;
      else {
        const [candidates, missing] = await Promise.all([tools.candidates({ excludeRecipeIds: turn.shownRecipeIds, limit: 10 }), tools.missingFromShoppingList()]);
        const list = candidates.map((c) => `- ${c.id} · ${c.title} · ${c.totalTimeMinutes.max} min · ${c.nutritionPerServing.kcal} kcal · ${c.nutritionPerServing.proteinG} g proteína`).join('\n');
        const answer = await this.ask(turn, tools, text, tools.newRecipes ? MAIN_SYSTEM + NEW_RECIPE : MAIN_SYSTEM, `Candidatas:\n${list || '(ninguna)'}\nEn su lista de compras: ${missing.slice(0, 15).join(', ') || 'nada'}`);
        reply = answer.reply;
        cards = candidates.filter((c) => answer.recipeIds.includes(c.id)).slice(0, MAX_CARDS);
        wanted = tools.newRecipes && !cards.length ? answer.newRecipe : [];
      }
    } catch (err) {
      this.log.warn({ err }, 'LLM del chef falló; uso reglas');
      yield* this.fallback.reply(turn, tools);
      return;
    }
    for (const w of words(reply)) yield { type: 'text', delta: w };
    if (wanted.length && tools.newRecipes) {
      cards = await tools.newRecipes({ ingredients: wanted, excludeRecipeIds: turn.shownRecipeIds }).catch((err: unknown) => {
        this.log.warn({ err }, 'no se pudieron generar recetas');
        return [];
      });
      if (!cards.length) for (const w of words(' No encontré una que te sirva con eso; prueba con otro ingrediente.')) yield { type: 'text', delta: w };
    }
    for (const [i, card] of cards.slice(0, MAX_CARDS).entries()) {
      const id = `b_card${i}`;
      yield { type: 'recipes', recipeIds: [card.id] };
      yield { type: 'block', block: { id, type: 'recipeCard', recipe: { ...card, reasonLabel: 'Para ti' } as unknown as Record<string, unknown>, actions: ['save', 'addToShoppingList', 'cook'] } };
      yield { type: 'block', block: { type: 'feedbackPrompt', targetBlockId: id, label: '¿Te late esta idea?', allowAnotherIdea: i === Math.min(cards.length, MAX_CARDS) - 1 } };
    }
    yield { type: 'block', block: { type: 'suggestedPrompts', options: context.type === 'recipe' ? RECIPE_PROMPTS : MAIN_PROMPTS } };
  }

  private async ask(turn: ChefTurn, tools: ChefTools, text: string, system: string, context: string): Promise<{ reply: string; recipeIds: string[]; newRecipe: string[] }> {
    const out = (await this.llm.chatJson([
      { role: 'system', content: `${system}\n\nPersona: ${turn.userName}. Preferencias y restricciones: ${tools.preferencesSummary()}\n${context}` },
      ...turn.history.map((m) => ({ role: m.role === 'chef' ? ('assistant' as const) : ('user' as const), content: m.text })),
      { role: 'user', content: text },
    ])) as { reply?: unknown; recipeIds?: unknown; recipeId?: unknown; newRecipe?: unknown } | null;
    const strings = (v: unknown) => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
    if (typeof out?.reply !== 'string' || !out.reply.trim()) throw new Error('El modelo no devolvió «reply»');
    return { reply: out.reply.trim(), recipeIds: strings(out.recipeIds ?? out.recipeId), newRecipe: strings(out.newRecipe) };
  }
}

const MAX_CARDS = 2;

const STYLE =
  'Eres el chef de Noshy: hablas en español de Colombia, cálido y breve. Respeta siempre sus alergias y restricciones; nunca propongas algo que choque con ellas. ' +
  'Solo hablas de cocina, comida, compras y nutrición general; no das consejo médico. ';
const MAIN_SYSTEM =
  `${STYLE}Máximo 3 frases. Responde la pregunta primero. Si la persona quiere una idea o receta, recomienda una o máximo dos de la lista de candidatas usando su id exacto; no inventes recetas ni ids. ` +
  'Responde solo JSON: {"reply": string, "recipeIds": string[], "newRecipe": string[]}. recipeIds va vacío si no pidió qué comer; newRecipe, vacío.';
const NEW_RECIPE =
  ' Excepción: si pidió una receta y NINGUNA candidata cumple lo que pidió (ingrediente, plato o estilo), deja recipeIds vacío y pon en newRecipe de 1 a 4 ingredientes principales ' +
  'en inglés, singular y minúsculas, del más al menos importante (ej. ["chicken", "rice"]): el sistema le mostrará hasta 2 recetas reales, que están en inglés. En reply di que se las buscas, sin describirlas.';
const RECIPE_SYSTEM =
  `${STYLE}Máximo 4 frases. Responde dudas sobre la receta de abajo: sustituciones, cantidades, técnica, conservación y macros. Usa sus datos; si no sabes algo, dilo. ` +
  'Responde solo JSON: {"reply": string}.';
