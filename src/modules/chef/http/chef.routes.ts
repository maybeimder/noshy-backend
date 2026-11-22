import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ChefController } from './chef.controller.js';
import { FeedbackBody, InsightParams, InsightVoteBody, MessageParams, MessagesQuery, ReadBody, SendMessageBody, ThreadBody, ThreadParams } from './chef.dto.js';

export async function chefRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new ChefController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Tu chef'];

  r.post('/me/chef/threads', { preHandler: done, schema: { tags, summary: 'Abrir (o recuperar) un hilo de receta', body: ThreadBody } }, (req, rep) => c.openThread(req, rep));
  r.get('/me/chef/threads/:threadId/messages', { preHandler: done, schema: { tags, summary: 'Historial de la conversación', params: ThreadParams, querystring: MessagesQuery } }, (req) => c.messages(req));
  r.post(
    '/me/chef/threads/:threadId/messages',
    {
      preHandler: done,
      config: { rateLimit: { max: 60, timeWindow: '1 hour', keyGenerator: (req) => `chef:${req.headers.authorization ?? req.ip}` } },
      schema: { tags, summary: 'Hablarle al chef (SSE con Accept: text/event-stream)', params: ThreadParams, body: SendMessageBody },
    },
    (req, rep) => c.send(req, rep),
  );
  r.post('/me/chef/threads/:threadId/read', { preHandler: done, schema: { tags, summary: 'Marcar como leído', params: ThreadParams, body: ReadBody } }, (req, rep) => c.read(req, rep));
  r.post('/me/chef/messages/:messageId/feedback', { preHandler: done, schema: { tags, summary: '👍 / 👎 a una idea', params: MessageParams, body: FeedbackBody } }, (req, rep) => c.feedback(req, rep));
  r.get('/me/chef/insights', { preHandler: done, schema: { tags, summary: 'Lo que tu chef ha aprendido', querystring: MessagesQuery } }, (req) => c.insights(req));
  r.post('/me/chef/insights/:insightId/feedback', { preHandler: done, schema: { tags, summary: 'Confirmar o corregir un aprendizaje', params: InsightParams, body: InsightVoteBody } }, (req) => c.voteInsight(req));
}
