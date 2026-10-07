import type { Request, Response } from 'express';
import { runHandler } from '../../../infrastructure/http/command-dispatch';
import { FeedbackHandlers } from '../events/feedback.handlers';
import type { createFeedback, listFeedback, listRecommendations } from '../feedback.service';

export class FeedbackController {
  static create = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof createFeedback>>(request, response, FeedbackHandlers.record, {
      params: { idempotencyKey: request.header('Idempotency-Key') },
      data: request.body
    });
    if (!outcome) return;
    const { result } = outcome;

    if ('ok' in result && !result.ok) {
      response.status(409).json({ code: result.code, message: result.message });
      return;
    }

    response.status(result.duplicate ? 200 : 201).json(result.entry);
  };

  static list = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof listFeedback>>(request, response, FeedbackHandlers.list);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };
}

export class RecommendationController {
  static list = async (request: Request, response: Response) => {
    const outcome = await runHandler<ReturnType<typeof listRecommendations>>(request, response, FeedbackHandlers.recommendations);
    if (!outcome) return;
    response.status(200).json(outcome.result);
  };
}