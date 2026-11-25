import type { Arg } from '../../../core/commands/command-bus.js';
import type { CommunityService } from '../community.service.js';

/** Comandos del módulo community. Comentarios, denuncias y seguir. */
export const communityCommands = (s: { community: CommunityService }) => ({
  'community.addComment': (c: { userId: string; recipeId: string; text: string }) => s.community.addComment(c.userId, c.recipeId, c.text),
  'community.deleteComment': (c: { userId: string; commentId: string }) => s.community.deleteComment(c.userId, c.commentId),
  'community.report': (c: { userId: string; input: Arg<CommunityService['report'], 1> }) => s.community.report(c.userId, c.input),
  'community.setFollowing': (c: { userId: string; followeeId: string; following: boolean }) => s.community.setFollowing(c.userId, c.followeeId, c.following),
});
