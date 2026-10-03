import type { Request, Response } from 'express';
import type { ChefAgentPort } from '../chef-agent.port';
import { respondWithChefAgent } from '../chef-agent.service';
import { addChefSessionMessage, closeChefSession, getChefSessionContext, openChefSession } from '../chef-session.service';
import { chefSessionMessageSchema, closeChefSessionSchema } from './chef-session.dto';

type AuthenticatedRequest = Request & { user?: { id: string; name: string; email: string } };

export class ChefSessionController {
  static open = (request: AuthenticatedRequest, response: Response) => {
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(201).json(openChefSession(request.user.id));
  };

  static close = (request: AuthenticatedRequest, response: Response) => {
    const parsed = closeChefSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = closeChefSession(request.user.id, sessionId, parsed.data);
    if (!result.ok) {
      const status = result.code === 'PREFERENCES_VERSION_CONFLICT' ? 409 : 404;
      response.status(status).json({
        code: result.code,
        message: result.message,
        ...('data' in result ? { session: result.data } : {})
      });
      return;
    }

    response.status(200).json(result.data);
  };

  static addMessage = (request: AuthenticatedRequest, response: Response) => {
    const parsed = chefSessionMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = addChefSessionMessage(request.user.id, sessionId, parsed.data.content);
    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };

  static context = (request: AuthenticatedRequest, response: Response) => {
    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = getChefSessionContext(request.user.id, sessionId);
    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static respond = async (request: AuthenticatedRequest, response: Response, agent: ChefAgentPort) => {
    const parsed = chefSessionMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: 'Datos inválidos.', issues: parsed.error.issues });
      return;
    }

    if (!request.user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const result = await respondWithChefAgent(request.user.id, sessionId, parsed.data.content, agent, parsed.data.recipeId);
    if (!result.ok) {
      const status = result.code === 'CHEF_AGENT_UNAVAILABLE' ? 503 : result.code === 'FEEDBACK_NOT_RECORDED' ? 502 : result.code === 'RECIPE_NOT_FOUND' ? 404 : 409;
      response.status(status).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };
}
