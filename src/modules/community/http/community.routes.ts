import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CommunityController } from './community.controller.js';
import { RecipeIdParam } from '../../../core/shared/common.dto.js';
import { CommentBody, CommentParams, CommentsQuery, CreatorsQuery, FeedQuery, ReportBody, UserParams } from './community.dto.js';

export async function communityRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new CommunityController(app.container);
  const done = [app.authenticate, app.requireOnboarding];
  const tags = ['Comunidad'];

  r.get('/community/feed', { preHandler: done, schema: { tags, summary: 'Feed de la comunidad', querystring: FeedQuery } }, (req) => c.feed(req));
  r.get('/community/creators', { preHandler: done, schema: { tags, summary: 'Fila de creadores', querystring: CreatorsQuery } }, (req) => c.creators(req));
  r.get('/community/recipes/:recipeId/comments', { preHandler: done, schema: { tags, summary: 'Comentarios de una receta', params: RecipeIdParam, querystring: CommentsQuery } }, (req) => c.comments(req));
  r.post('/community/recipes/:recipeId/comments', { preHandler: done, schema: { tags, summary: 'Comentar', params: RecipeIdParam, body: CommentBody } }, (req, rep) => c.addComment(req, rep));
  r.delete('/community/comments/:commentId', { preHandler: done, schema: { tags, summary: 'Borrar un comentario propio o de tu receta', params: CommentParams } }, (req, rep) => c.deleteComment(req, rep));
  r.get('/community/users/:userId', { preHandler: done, schema: { tags, summary: 'Perfil de un creador', params: UserParams } }, (req) => c.creator(req));
  r.post('/community/reports', { preHandler: done, config: { rateLimit: { max: 20, timeWindow: '1 day' } }, schema: { tags, summary: 'Denunciar una receta o un comentario', body: ReportBody } }, (req, rep) => c.report(req, rep));
  r.put('/me/following/:userId', { preHandler: done, schema: { tags, summary: 'Seguir a un creador', params: UserParams } }, (req) => c.follow(req));
  r.delete('/me/following/:userId', { preHandler: done, schema: { tags, summary: 'Dejar de seguir', params: UserParams } }, (req) => c.unfollow(req));
}
