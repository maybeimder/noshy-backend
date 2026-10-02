import { z } from 'zod';

export const feedbackInputSchema = z.object({
  targetType: z.enum(['recipe', 'plan', 'ingredient']),
  targetId: z.string().min(1, 'El identificador es requerido.'),
  targetName: z.string().min(1, 'El nombre es requerido.'),
  eventType: z.enum(['selected', 'discarded', 'prepared', 'repeated', 'rated', 'preference_changed']).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  note: z.string().max(500).optional()
}).superRefine((value, context) => {
  if (value.eventType === 'rated' && value.rating === undefined) {
    context.addIssue({ code: 'custom', path: ['rating'], message: 'La valoración es requerida para este evento.' });
  }

  if (value.eventType === undefined && value.rating === undefined) {
    context.addIssue({ code: 'custom', path: ['eventType'], message: 'El evento o la valoración son requeridos.' });
  }
});
