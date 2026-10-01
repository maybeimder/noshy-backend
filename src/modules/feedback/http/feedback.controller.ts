import type { Request, Response } from 'express';
import { createFeedback, listRecommendations } from '../feedback.service';
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

    const feedback = createFeedback(user.id, parsed.data);
    response.status(201).json(feedback);
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
