import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { MediaController } from './media.controller.js';
import { StorageUploadQuery, UploadBody } from './media.dto.js';

export async function mediaRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new MediaController(app.container);

  r.post('/media/uploads', { preHandler: [app.authenticate], schema: { tags: ['Fotos'], summary: 'Pedir URL firmada para subir una foto', body: UploadBody } }, (req, rep) => c.requestUpload(req, rep));

  // Driver local de storage: imita el PUT directo a S3 y sirve los archivos públicos.
  r.put('/storage/upload', { schema: { hide: true, querystring: StorageUploadQuery } }, (req, rep) => c.storagePut(req, rep));
  r.get('/storage/files/*', { schema: { hide: true } }, (req, rep) => c.storageGet(req as never, rep));
}
