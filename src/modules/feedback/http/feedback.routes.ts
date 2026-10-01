import { Router } from 'express';
import { requireAuth } from '../../auth/http/auth.middleware';
import { FeedbackController, RecommendationController } from './feedback.controller';

const feedbackRouter = Router();
feedbackRouter.use(requireAuth);
feedbackRouter.post('/', FeedbackController.create);

const recommendationsRouter = Router();
recommendationsRouter.use(requireAuth);
recommendationsRouter.get('/', RecommendationController.list);

export { feedbackRouter, recommendationsRouter };
