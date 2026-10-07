// Entrada única (HTTP y RabbitMQ) del módulo de feedback.
import { defineHandler } from '../../../core/commands/command-bus';
import { createFeedback, listFeedback, listRecommendations } from '../feedback.service';
import { feedbackInputSchema } from '../http/feedback.dto';

export const FeedbackHandlers = {
  record: 'feedback.record',
  list: 'feedback.list',
  recommendations: 'recommendations.list'
} as const;

export const feedbackHandlers = [
  defineHandler({
    name: FeedbackHandlers.record,
    schema: feedbackInputSchema,
    // params.idempotencyKey = el header Idempotency-Key de HTTP (opcional)
    execute: ({ userId, params, data }) => createFeedback(userId, data, params.idempotencyKey)
  }),
  defineHandler({ name: FeedbackHandlers.list, execute: ({ userId }) => listFeedback(userId) }),
  defineHandler({ name: FeedbackHandlers.recommendations, execute: ({ userId }) => listRecommendations(userId) })
];
