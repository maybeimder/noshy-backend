import { createFeedback } from '../feedback/feedback.service';
import type { ChefAgentPort } from './chef-agent.port';
import {
  addChefAssistantMessage,
  addChefSessionMessage,
  getChefSessionContext
} from './chef-session.service';

export async function respondWithChefAgent(
  userId: string,
  sessionId: string,
  content: string,
  agent: ChefAgentPort
) {
  const userMessage = addChefSessionMessage(userId, sessionId, content);
  if (!userMessage.ok) {
    return userMessage;
  }

  const context = getChefSessionContext(userId, sessionId);
  if (!context.ok) {
    return context;
  }

  let agentResponse;
  try {
    agentResponse = await agent.respond({ ...context.data, message: content });
  } catch {
    return {
      ok: false,
      code: 'CHEF_AGENT_UNAVAILABLE',
      message: 'El agente chef no está disponible.'
    } as const;
  }

  const assistantMessage = addChefAssistantMessage(userId, sessionId, agentResponse.message);
  if (!assistantMessage.ok) {
    return assistantMessage;
  }

  const feedback = [];
  for (const event of agentResponse.feedback) {
    const result = createFeedback(userId, { ...event, sessionId }, event.idempotencyKey);
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
