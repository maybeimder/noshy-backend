import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import { Errors } from '../../../core/shared/errors.js';
import type { StorageUploadQuery, UploadBody } from './media.dto.js';

export class MediaController {
  constructor(private readonly c: Container) {}

  requestUpload = async (req: Req<{ Body: z.infer<typeof UploadBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.commands.execute('media.requestUpload', { userId: req.user.id, input: req.body }));
  };

  /** Recibe el archivo del driver local de storage (equivale al PUT directo a S3). */
  storagePut = async (req: Req<{ Querystring: z.infer<typeof StorageUploadQuery> }>, reply: Rep) => {
    if (!Buffer.isBuffer(req.body)) throw Errors.unsupportedMedia();
    await this.c.commands.execute('media.receiveUpload', { key: req.query.key, expires: req.query.expires, sig: req.query.sig, body: req.body, contentType: req.headers['content-type']?.split(';')[0] });
    return reply.code(200).send();
  };

  /** Fotos de referencia por tipo de plato (`src/assets/dishes`). */
  dishPhoto = async (req: Req<{ Params: { file: string } }>, reply: Rep) => {
    const file = await this.c.services.media.dishPhoto(req.params.file);
    return reply.header('Content-Type', 'image/webp').header('Cross-Origin-Resource-Policy', 'cross-origin').header('Cache-Control', 'public, max-age=604800').send(file);
  };

  storageGet = async (req: Req<{ Params: { '*': string } }>, reply: Rep) => {
    const { file, contentType } = await this.c.services.media.publicFile(req.params['*']);
    return reply.header('Content-Type', contentType).header('Cross-Origin-Resource-Policy', 'cross-origin').header('Cache-Control', 'public, max-age=86400').send(file);
  };
}
