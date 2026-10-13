import { z } from 'zod';
import type { ChefAgentContext, ChefAgentFeedback, ChefAgentPort, ChefAgentResponse } from '../../modules/chef-sessions/chef-agent.port';
import { extractJson, OpenRouterClient, type OpenRouterOptions } from './openrouter.client';

export { DEFAULT_OPENROUTER_MODELS, type OpenRouterOptions } from './openrouter.client';

const MAX_HISTORY = 20;

const feedbackSchema = z.object({
  targetType: z.enum(['recipe', 'plan', 'ingredient']),
  targetId: z.string().trim().min(1),
  targetName: z.string().trim().min(1),
  eventType: z.enum(['selected', 'discarded', 'prepared', 'repeated', 'preference_changed']),
  note: z.string().trim().max(500).optional()
});

const replySchema = z.object({
  message: z.string().trim().min(1),
  feedback: z.array(z.unknown()).optional()
});

const SYSTEM_PROMPT = `Eres el Chef de Noshy: un asistente de cocina y nutrición que responde en español, de forma breve y práctica.
Usa el plan nutricional, las preferencias, el inventario y la receta del contexto. Prioriza ingredientes que el usuario ya tiene
y respeta sus restricciones. No inventes datos médicos.

Responde SIEMPRE con un único objeto JSON, sin texto alrededor:
{"message": "<tu respuesta al usuario>", "feedback": [<eventos>]}

"feedback" registra solo lo que el usuario expresó EXPLÍCITAMENTE en su último mensaje (si no, déjalo vacío []). Cada evento:
{"targetType": "recipe"|"plan"|"ingredient", "targetId": "<id del contexto o el nombre en minúsculas>", "targetName": "<nombre>",
 "eventType": "selected"|"discarded"|"prepared"|"repeated"|"preference_changed", "note": "<opcional>"}`;

function describeContext(context: ChefAgentContext): string {
  const sections = [
    `Preferencias del usuario (versión ${context.preferencesVersion}):\n${context.preferencesMarkdown}`,
    context.nutritionPlan
      ? `Plan nutricional activo: ${JSON.stringify({
          objetivo: context.nutritionPlan.objective,
          metas: context.nutritionPlan.targets,
          restricciones: context.nutritionPlan.restrictions,
          comidasPorDia: context.nutritionPlan.mealsPerDay
        })}`
      : 'Plan nutricional activo: ninguno.',
    context.inventory.length > 0
      ? `Inventario: ${context.inventory.map((item) => `${item.name} ${item.quantity} ${item.unit}`).join('; ')}`
      : 'Inventario: vacío.',
    context.recipe
      ? `Receta en discusión (id ${context.recipe.id}): ${JSON.stringify({
          titulo: context.recipe.title,
          ingredientes: context.recipe.ingredients,
          pasos: context.recipe.instructions
        })}`
      : ''
  ];
  return sections.filter(Boolean).join('\n\n');
}

export function parseChefReply(content: string): ChefAgentResponse {
  try {
    const reply = replySchema.parse(extractJson(content));
    // Un evento mal formado se descarta; no invalida la respuesta completa.
    const feedback = (reply.feedback ?? []).flatMap((item): ChefAgentFeedback[] => {
      const parsed = feedbackSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return { message: reply.message, feedback };
  } catch {
    // El modelo no respetó el formato: se entrega su texto tal cual y sin feedback.
    return { message: content.trim(), feedback: [] };
  }
}

// Adaptador del puerto ChefAgentPort contra OpenRouter (API compatible con OpenAI).
export class OpenRouterChefAgent implements ChefAgentPort {
  private readonly client: OpenRouterClient;

  constructor(options: OpenRouterOptions) {
    this.client = new OpenRouterClient(options);
  }

  async respond(context: ChefAgentContext): Promise<ChefAgentResponse> {
    // El mensaje actual ya está guardado como último del historial: no se duplica.
    const history = context.messages.slice(-MAX_HISTORY);
    const last = history.at(-1);
    const previous = last?.role === 'user' && last.content === context.message.trim() ? history.slice(0, -1) : history;

    const content = await this.client.chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: describeContext(context) },
        ...previous.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: context.message }
      ],
      0.4
    );
    return parseChefReply(content);
  }
}
