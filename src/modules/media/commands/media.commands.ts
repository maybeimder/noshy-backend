import type { Arg } from '../../../core/commands/command-bus.js';
import type { MediaService } from '../media.service.js';

/** Comandos del módulo media. Fotos. */
export const mediaCommands = (s: { media: MediaService }) => ({
  'media.requestUpload': (c: { userId: string; input: Arg<MediaService['requestUpload'], 1> }) => s.media.requestUpload(c.userId, c.input),
  'media.receiveUpload': (c: { key: string; expires: number; sig: string; body: Buffer; contentType: string | undefined }) => s.media.receiveUpload(c.key, c.expires, c.sig, c.body, c.contentType),
});
