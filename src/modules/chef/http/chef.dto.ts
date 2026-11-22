import { z } from 'zod';
import { Page } from '../../../core/shared/common.dto.js';

export const ThreadBody = z.object({ context: z.object({ type: z.literal('recipe'), recipeId: z.string().min(3).max(64) }) });
export const ThreadParams = z.object({ threadId: z.string().min(3).max(64) });
export const MessagesQuery = Page;
const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quickReply'), messageId: z.string(), optionId: z.string() }),
  z.object({ type: z.literal('suggestedPrompt'), messageId: z.string(), optionId: z.string() }),
  z.object({ type: z.literal('anotherIdea'), messageId: z.string(), blockId: z.string() }),
  z.object({ type: z.literal('openChef'), prompt: z.string().max(1000).optional(), threadId: z.string().optional() }),
  z.object({ type: z.literal('openRecipe'), recipeId: z.string() }),
  z.object({ type: z.literal('openRecommendations'), filters: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal('openScreen'), screen: z.string() }),
]);
export const SendMessageBody = z.object({
  clientMessageId: z.string().min(8).max(64),
  input: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().max(1000), via: z.enum(['keyboard', 'voice']).default('keyboard') }),
    z.object({ type: z.literal('action'), action: Action }),
  ]),
});
export const ReadBody = z.object({ lastReadMessageId: z.string().min(3).max(64) });
export const MessageParams = z.object({ messageId: z.string().min(3).max(64) });
export const FeedbackBody = z.object({ blockId: z.string().min(1).max(40), rating: z.enum(['up', 'down']), reason: z.string().max(280).optional() });
export const InsightParams = z.object({ insightId: z.string().min(3).max(64) });
export const InsightVoteBody = z.object({ vote: z.enum(['up', 'down']) });
