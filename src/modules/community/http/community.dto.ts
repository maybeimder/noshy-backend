import { z } from 'zod';
import { Page } from '../../../core/shared/common.dto.js';

export const FeedQuery = Page.extend({ filter: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
export const CreatorsQuery = z.object({ limit: z.coerce.number().int().min(1).max(30).optional() });
export const CommentsQuery = Page;
export const CommentBody = z.object({ text: z.string().trim().min(1).max(500) });
export const UserParams = z.object({ userId: z.string().min(3).max(64) });
