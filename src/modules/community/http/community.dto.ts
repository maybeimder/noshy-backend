import { z } from 'zod';
import { Page } from '../../../core/shared/common.dto.js';

export const FeedQuery = Page.extend({ filter: z.string().max(40).optional(), q: z.string().trim().max(60).optional(), authorId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });
export const CreatorsQuery = z.object({ limit: z.coerce.number().int().min(1).max(30).optional() });
export const CommentsQuery = Page;
export const CommentBody = z.object({ text: z.string().trim().min(1).max(500) });
export const CommentParams = z.object({ commentId: z.string().min(3).max(64) });
export const ReportBody = z.object({ targetType: z.enum(['recipe', 'comment']), targetId: z.string().min(3).max(64), reason: z.enum(['spam', 'offensive', 'unsafe', 'stolen', 'other']) });
export const UserParams = z.object({ userId: z.string().min(3).max(64) });
