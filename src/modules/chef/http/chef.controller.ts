import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { FeedbackBody, InsightParams, InsightVoteBody, MessageParams, MessagesQuery, ReadBody, SendMessageBody, ThreadBody, ThreadParams } from './chef.dto.js';
import type { StreamEvent, ChefInput } from '../chef.service.js';

export class ChefController {
  constructor(private readonly c: Container) {}

  openThread = async (req: Req<{ Body: z.infer<typeof ThreadBody> }>, reply: Rep) => {
    const r = await this.c.services.chef.openRecipeThread(req.user.id, req.body.context.recipeId);
    reply.code(r.created ? 201 : 200);
    return ok(r.thread);
  };

  messages = async (req: Req<{ Params: z.infer<typeof ThreadParams>; Querystring: z.infer<typeof MessagesQuery> }>) =>
    this.c.services.chef.messages(req.user.id, req.params.threadId, req.query.limit, req.query.cursor);

  /**
   * Con `Accept: text/event-stream` transmite por SSE; si no, responde JSON completo.
   * Los errores antes del primer evento salen como JSON normal (404, 409 CHEF_BUSY, 422).
   */
  send = async (req: Req<{ Params: z.infer<typeof ThreadParams>; Body: z.infer<typeof SendMessageBody> }>, reply: Rep) => {
    const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
    const body = { clientMessageId: req.body.clientMessageId, input: req.body.input as ChefInput };
    if (!wantsStream) {
      const events: StreamEvent[] = [];
      await this.c.services.chef.send(req.user.id, req.params.threadId, body, (e) => void events.push(e));
      const created = events.filter((e): e is Extract<StreamEvent, { event: 'message.created' }> => e.event === 'message.created').map((e) => e.data.message);
      const chefMsg = created.find((m) => m.role === 'chef');
      const blocks = events.filter((e): e is Extract<StreamEvent, { event: 'block.completed' }> => e.event === 'block.completed').map((e) => e.data.block);
      return ok({ userMessage: created.find((m) => m.role === 'user') ?? null, chefMessage: chefMsg ? { ...chefMsg, blocks } : null });
    }
    let started = false;
    const write = (e: StreamEvent) => {
      if (!started) {
        reply.hijack();
        // hijack() se salta las cabeceras de Fastify: sin copiarlas, el navegador bloquea el stream por CORS.
        for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) reply.raw.setHeader(name, value);
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        started = true;
      }
      reply.raw.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };
    try {
      await this.c.services.chef.send(req.user.id, req.params.threadId, body, write);
    } catch (err) {
      if (!started) throw err;
      req.log.error({ err }, 'falló el stream del chef');
    }
    if (started) reply.raw.end();
    return reply;
  };

  read = async (req: Req<{ Params: z.infer<typeof ThreadParams>; Body: z.infer<typeof ReadBody> }>, reply: Rep) => {
    await this.c.services.chef.markRead(req.user.id, req.params.threadId, req.body.lastReadMessageId);
    return reply.code(204).send();
  };

  feedback = async (req: Req<{ Params: z.infer<typeof MessageParams>; Body: z.infer<typeof FeedbackBody> }>, reply: Rep) => {
    await this.c.services.chef.feedback(req.user.id, req.params.messageId, req.body.blockId, req.body.rating);
    return reply.code(204).send();
  };

  insights = async (req: Req<{ Querystring: z.infer<typeof MessagesQuery> }>) => this.c.services.insights.list(req.user.id, req.query.limit, req.query.cursor);

  voteInsight = async (req: Req<{ Params: z.infer<typeof InsightParams>; Body: z.infer<typeof InsightVoteBody> }>) =>
    ok(await this.c.services.insights.vote(req.user.id, req.params.insightId, req.body.vote));
}
