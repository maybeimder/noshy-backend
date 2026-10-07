// Entrada única (HTTP y RabbitMQ) del módulo de sesiones del agente chef.
import { defineHandler } from '../../../core/commands/command-bus';
import type { ChefAgentPort } from '../chef-agent.port';
import { respondWithChefAgent } from '../chef-agent.service';
import { addChefSessionMessage, closeChefSession, getChefSessionContext, openChefSession } from '../chef-session.service';
import { chefSessionMessageSchema, closeChefSessionSchema } from '../http/chef-session.dto';

export const ChefSessionHandlers = {
  open: 'chef.open_session',
  addMessage: 'chef.add_message',
  context: 'chef.context',
  respond: 'chef.respond',
  close: 'chef.close_session'
} as const;

// El agente (proveedor de IA) se inyecta al armar el CommandBus, igual que createServer({ chefAgent }).
export function createChefSessionHandlers(agent: ChefAgentPort) {
  return [
    defineHandler({ name: ChefSessionHandlers.open, execute: ({ userId }) => openChefSession(userId) }),
    defineHandler({
      name: ChefSessionHandlers.addMessage,
      schema: chefSessionMessageSchema,
      params: ['sessionId'],
      execute: ({ userId, params, data }) => addChefSessionMessage(userId, params.sessionId!, data.content)
    }),
    defineHandler({
      name: ChefSessionHandlers.context,
      params: ['sessionId'],
      execute: ({ userId, params }) => getChefSessionContext(userId, params.sessionId!)
    }),
    defineHandler({
      name: ChefSessionHandlers.respond,
      schema: chefSessionMessageSchema,
      params: ['sessionId'],
      execute: ({ userId, params, data }) => respondWithChefAgent(userId, params.sessionId!, data.content, agent, data.recipeId)
    }),
    defineHandler({
      name: ChefSessionHandlers.close,
      schema: closeChefSessionSchema,
      params: ['sessionId'],
      execute: ({ userId, params, data }) => closeChefSession(userId, params.sessionId!, data)
    })
  ];
}
