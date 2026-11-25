import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { RecipeIdParam } from '../../../core/shared/common.dto.js';
import type { CommentBody, CommentParams, CommentsQuery, CreatorsQuery, FeedQuery, ReportBody, UserParams } from './community.dto.js';

export class CommunityController {
  constructor(private readonly c: Container) {}

  feed = async (req: Req<{ Querystring: z.infer<typeof FeedQuery> }>) => this.c.services.community.feed(req.user.id, req.query);

  creators = async (req: Req<{ Querystring: z.infer<typeof CreatorsQuery> }>) => ok(await this.c.services.community.creators(req.user.id, req.query.limit));

  comments = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Querystring: z.infer<typeof CommentsQuery> }>) =>
    this.c.services.community.comments(req.user.id, req.params.recipeId, req.query);

  addComment = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Body: z.infer<typeof CommentBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.commands.execute('community.addComment', { userId: req.user.id, recipeId: req.params.recipeId, text: req.body.text }));
  };

  creator = async (req: Req<{ Params: z.infer<typeof UserParams> }>) => ok(await this.c.services.community.creator(req.user.id, req.params.userId));

  deleteComment = async (req: Req<{ Params: z.infer<typeof CommentParams> }>, reply: Rep) => {
    await this.c.commands.execute('community.deleteComment', { userId: req.user.id, commentId: req.params.commentId });
    return reply.code(204).send();
  };

  report = async (req: Req<{ Body: z.infer<typeof ReportBody> }>, reply: Rep) => {
    await this.c.commands.execute('community.report', { userId: req.user.id, input: req.body });
    return reply.code(204).send();
  };

  follow = async (req: Req<{ Params: z.infer<typeof UserParams> }>) => ok(await this.c.commands.execute('community.setFollowing', { userId: req.user.id, followeeId: req.params.userId, following: true }));

  unfollow = async (req: Req<{ Params: z.infer<typeof UserParams> }>) => ok(await this.c.commands.execute('community.setFollowing', { userId: req.user.id, followeeId: req.params.userId, following: false }));
}
