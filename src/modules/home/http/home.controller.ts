import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { DayParams, DismissBody, HistoryQuery, HomeQuery, LogMealBody, MealParams, NudgeParams, NudgesQuery, RecommendationsQuery } from './home.dto.js';
import type { LogMealInput } from '../days.service.js';

export class HomeController {
  constructor(private readonly c: Container) {}

  home = async (req: Req<{ Querystring: z.infer<typeof HomeQuery> }>) => ok(await this.c.services.home.get(req.user.id, req.tz, req.query.date));

  history = async (req: Req<{ Querystring: z.infer<typeof HistoryQuery> }>) => ok(await this.c.services.days.history(req.user.id, req.query.from, req.query.to));

  day = async (req: Req<{ Params: z.infer<typeof DayParams> }>) => ok(await this.c.services.days.summary(req.user.id, req.params.date, req.tz));

  logMeal = async (req: Req<{ Params: z.infer<typeof DayParams>; Body: z.infer<typeof LogMealBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.days.log(req.user.id, req.params.date, req.tz, req.body as LogMealInput));
  };

  deleteMeal = async (req: Req<{ Params: z.infer<typeof MealParams> }>) => ok(await this.c.services.days.remove(req.user.id, req.params.date, req.tz, req.params.mealId));

  recommendations = async (req: Req<{ Querystring: z.infer<typeof RecommendationsQuery> }>) => this.c.services.recommendations.recommend(req.user.id, req.query);

  nudges = async (req: Req<{ Querystring: z.infer<typeof NudgesQuery> }>) => ok(await this.c.services.nudges.list(req.user.id, req.query.placement));

  dismissNudge = async (req: Req<{ Params: z.infer<typeof NudgeParams>; Body: z.infer<typeof DismissBody> }>, reply: Rep) => {
    await this.c.services.nudges.dismiss(req.user.id, req.params.nudgeId, req.body.reason);
    return reply.code(204).send();
  };
}
