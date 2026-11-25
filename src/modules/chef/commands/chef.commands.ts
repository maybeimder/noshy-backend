import type { Arg } from '../../../core/commands/command-bus.js';
import type { ChefService } from '../chef.service.js';
import type { InsightsService } from '../insights.service.js';

/** Comandos del módulo chef. Conversación con el chef y aprendizajes. */
export const chefCommands = (s: { chef: ChefService; insights: InsightsService }) => ({
  'chef.openRecipeThread': (c: { userId: string; recipeId: string }) => s.chef.openRecipeThread(c.userId, c.recipeId),
  'chef.sendMessage': (c: { userId: string; threadId: string; body: Arg<ChefService['send'], 2>; emit: Arg<ChefService['send'], 3> }) => s.chef.send(c.userId, c.threadId, c.body, c.emit),
  'chef.markRead': (c: { userId: string; threadId: string; lastReadMessageId: string }) => s.chef.markRead(c.userId, c.threadId, c.lastReadMessageId),
  'chef.giveFeedback': (c: { userId: string; messageId: string; blockId: string; rating: Arg<ChefService['feedback'], 3> }) => s.chef.feedback(c.userId, c.messageId, c.blockId, c.rating),
  'chef.voteInsight': (c: { userId: string; insightId: string; vote: Arg<InsightsService['vote'], 2> }) => s.insights.vote(c.userId, c.insightId, c.vote),
});
