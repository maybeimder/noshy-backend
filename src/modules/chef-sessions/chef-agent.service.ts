import { createFeedback } from '../feedback/feedback.service';
import { getRecipeForChef } from '../recipes/recipe.service';
import type { ChefAgentPort } from './chef-agent.port';
import {
  addChefAssistantMessage,
  addChefSessionMessage,
  getChefSessionContext
} from './chef-session.service';

// No es una sola transacción a propósito: en medio hay una llamada a la IA (lenta y externa)
// y no se debe mantener una transacción abierta mientras tanto. Cada paso es atómico por sí mismo.
export async function respondWithChefAgent(
  userId: string,
  sessionId: string,
  content: string,
  agent: ChefAgentPort,
  recipeId?: string
) {
  const recipe = recipeId ? (await getRecipeForChef(userId, recipeId)) ?? undefined : undefined;
  if (recipeId && !recipe) {
    return { ok: false, code: 'RECIPE_NOT_FOUND', message: 'No existe la receta solicitada.' } as const;
  }

  const userMessage = await addChefSessionMessage(userId, sessionId, content);
  if (!userMessage.ok) {
    return userMessage;
  }

  const context = await getChefSessionContext(userId, sessionId);
  if (!context.ok) {
    return context;
  }

  let agentResponse;
  try {
    agentResponse = await agent.respond({ ...context.data, message: content, recipe });
  } catch {
    return {
      ok: false,
      code: 'CHEF_AGENT_UNAVAILABLE',
      message: 'El agente chef no está disponible.'
    } as const;
  }

  const assistantMessage = await addChefAssistantMessage(userId, sessionId, agentResponse.message);
  if (!assistantMessage.ok) {
    return assistantMessage;
  }

  const feedback = [];
  for (const event of agentResponse.feedback) {
    const result = await createFeedback(userId, { ...event, sessionId }, event.idempotencyKey);
    if ('ok' in result && !result.ok) {
      return {
        ok: false,
        code: 'FEEDBACK_NOT_RECORDED',
        message: 'No se pudo registrar el feedback detectado por el agente.'
      } as const;
    }
    feedback.push(result.entry);
  }

  return {
    ok: true,
    data: {
      message: assistantMessage.data,
      feedback
    }
  } as const;
}
