import type { Request, Response } from 'express';
import { routeParam, runHandler } from '../../../infrastructure/http/command-dispatch';
import type { respondWithChefAgent } from '../chef-agent.service';
import type { addChefSessionMessage, closeChefSession, getChefSessionContext, openChefSession } from '../chef-session.service';
import { ChefSessionHandlers } from '../events/chef-session.handlers';

export class ChefSessionController {
  static open = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof openChefSession>>>(request, response, ChefSessionHandlers.open);
    if (!outcome) return;
    response.status(201).json(outcome.result);
  };

  static close = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof closeChefSession>>>(request, response, ChefSessionHandlers.close, {
      params: { sessionId: routeParam(request) },
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      const status = result.code === 'PREFERENCES_VERSION_CONFLICT' ? 409 : 404;
      response.status(status).json({
        code: result.code,
        message: 'message' in result ? result.message : undefined,
        ...('data' in result ? { session: result.data } : {})
      });
      return;
    }

    response.status(200).json(result.data);
  };

  static addMessage = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof addChefSessionMessage>>>(request, response, ChefSessionHandlers.addMessage, {
      params: { sessionId: routeParam(request) },
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(201).json(result.data);
  };

  static context = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof getChefSessionContext>>>(request, response, ChefSessionHandlers.context, {
      params: { sessionId: routeParam(request) }
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };

  static respond = async (request: Request, response: Response) => {
    const outcome = await runHandler<Awaited<ReturnType<typeof respondWithChefAgent>>>(request, response, ChefSessionHandlers.respond, {
      params: { sessionId: routeParam(request) },
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;
    if (!result.ok) {
      const status = result.code === 'CHEF_AGENT_UNAVAILABLE' ? 503 : result.code === 'FEEDBACK_NOT_RECORDED' ? 502 : result.code === 'RECIPE_NOT_FOUND' ? 404 : 409;
      response.status(status).json({ code: result.code, message: result.message });
      return;
    }

    response.status(200).json(result.data);
  };
}