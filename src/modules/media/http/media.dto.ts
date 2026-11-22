import { z } from 'zod';

export const UploadBody = z.object({
  purpose: z.enum(['recipeCover', 'cookedPhoto', 'avatar']),
  contentType: z.string().max(60),
  sizeBytes: z.number().int().positive(),
});
export const StorageUploadQuery = z.object({ key: z.string().max(300), expires: z.coerce.number().int(), sig: z.string().max(200) });
