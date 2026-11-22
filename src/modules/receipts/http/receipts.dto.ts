import { z } from 'zod';

export const ReceiptParams = z.object({ receiptId: z.string().min(3).max(64) });
export const ReceiptItemParams = z.object({ receiptId: z.string().min(3).max(64), itemId: z.string().min(3).max(64) });
export const ReceiptItemBody = z.object({ addToPantry: z.boolean() });
