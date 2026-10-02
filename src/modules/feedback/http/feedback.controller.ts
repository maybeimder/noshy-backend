import type { Request, Response } from 'express';
import { createFeedback, listFeedback, listRecommendations } from '../feedback.service';
import { feedbackInputSchema } from './feedback.dto';

export class FeedbackController {
  static create = (request: Request, response: Response) => {
    const parsed = feedbackInputSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        message: 'Datos inválidos.',
        issues: parsed.error.issues
      });
      return;
    }

    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    const result = createFeedback(user.id, parsed.data, request.header('Idempotency-Key'));
    response.status(result.duplicate ? 200 : 201).json(result.entry);
  };

  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listFeedback(user.id));
  };
}

export class RecommendationController {
  static list = (request: Request, response: Response) => {
    const user = (request as Request & { user?: { id: string; name: string; email: string } }).user;
    if (!user) {
      response.status(401).json({ message: 'No autorizado.' });
      return;
    }

    response.status(200).json(listRecommendations(user.id));
  };
}
