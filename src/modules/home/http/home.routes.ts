import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { HomeController } from './home.controller.js';
import { DayParams, DismissBody, HistoryQuery, HomeQuery, LogMealBody, MealParams, NudgeParams, NudgesQuery, RecommendationsQuery } from './home.dto.js';

export async function homeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new HomeController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Inicio'];

  r.get('/me/home', { preHandler: done, schema: { tags, summary: 'Todo lo de Inicio en una llamada', querystring: HomeQuery } }, (req) => c.home(req));
  r.get('/me/days', { preHandler: done, schema: { tags, summary: 'Historial: totales por día', querystring: HistoryQuery } }, (req) => c.history(req));
  r.get('/me/days/:date', { preHandler: done, schema: { tags, summary: 'Resumen nutricional del día', params: DayParams } }, (req) => c.day(req));
  r.post('/me/days/:date/meals', { preHandler: [...done, app.idempotent], schema: { tags, summary: 'Registrar una comida', params: DayParams, body: LogMealBody } }, (req, rep) => c.logMeal(req, rep));
  r.delete('/me/days/:date/meals/:mealId', { preHandler: done, schema: { tags, summary: 'Borrar un registro', params: MealParams } }, (req) => c.deleteMeal(req));
  r.get('/me/recommendations', { preHandler: done, schema: { tags, summary: 'Ideas de recetas', querystring: RecommendationsQuery } }, (req) => c.recommendations(req));
  r.get('/me/nudges', { preHandler: done, schema: { tags, summary: 'Avisos del chef', querystring: NudgesQuery } }, (req) => c.nudges(req));
  r.post('/me/nudges/:nudgeId/dismiss', { preHandler: done, schema: { tags, summary: 'Descartar un aviso', params: NudgeParams, body: DismissBody } }, (req, rep) => c.dismissNudge(req, rep));
}
