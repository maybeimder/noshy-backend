import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { AbandonBody, CompleteBody, EventsBody, SessionParams, StartBody } from './cooking.dto.js';
import type { CookingEventInput } from '../cooking.service.js';

export class CookingController {
  constructor(private readonly c: Container) {}

  start = async (req: Req<{ Body: z.infer<typeof StartBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.cooking.start(req.user.id, req.body));
  };

  active = async (req: Req, reply: Rep) => {
    const s = await this.c.services.cooking.active(req.user.id);
    return s ? ok(s) : reply.code(204).send();
  };

  get = async (req: Req<{ Params: z.infer<typeof SessionParams> }>) => ok(await this.c.services.cooking.get(req.user.id, req.params.sessionId));

  events = async (req: Req<{ Params: z.infer<typeof SessionParams>; Body: z.infer<typeof EventsBody> }>, reply: Rep) => {
    reply.code(202);
    return ok(await this.c.services.cooking.recordEvents(req.user.id, req.params.sessionId, req.body.events as CookingEventInput[]));
  };

  complete = async (req: Req<{ Params: z.infer<typeof SessionParams>; Body: z.infer<typeof CompleteBody> }>) =>
    ok(await this.c.services.cooking.complete(req.user.id, req.tz, req.params.sessionId, req.body));

  abandon = async (req: Req<{ Params: z.infer<typeof SessionParams>; Body: z.infer<typeof AbandonBody> }>, reply: Rep) => {
    await this.c.services.cooking.abandon(req.user.id, req.params.sessionId, req.body);
    return reply.code(204).send();
  };
}
