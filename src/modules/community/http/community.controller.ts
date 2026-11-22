import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { RecipeIdParam } from '../../../core/shared/common.dto.js';
import type { CommentBody, CommentsQuery, CreatorsQuery, FeedQuery, UserParams } from './community.dto.js';

export class CommunityController {
  constructor(private readonly c: Container) {}

  feed = async (req: Req<{ Querystring: z.infer<typeof FeedQuery> }>) => this.c.services.community.feed(req.user.id, req.query);

  creators = async (req: Req<{ Querystring: z.infer<typeof CreatorsQuery> }>) => ok(await this.c.services.community.creators(req.user.id, req.query.limit));

  comments = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Querystring: z.infer<typeof CommentsQuery> }>) =>
    this.c.services.community.comments(req.user.id, req.params.recipeId, req.query);

  addComment = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Body: z.infer<typeof CommentBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.services.community.addComment(req.user.id, req.params.recipeId, req.body.text));
  };

  follow = async (req: Req<{ Params: z.infer<typeof UserParams> }>) => ok(await this.c.services.community.setFollowing(req.user.id, req.params.userId, true));

  unfollow = async (req: Req<{ Params: z.infer<typeof UserParams> }>) => ok(await this.c.services.community.setFollowing(req.user.id, req.params.userId, false));
}
