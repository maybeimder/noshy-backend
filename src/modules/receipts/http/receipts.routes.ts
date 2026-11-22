import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptItemBody, ReceiptItemParams, ReceiptParams } from './receipts.dto.js';

export async function receiptsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const c = new ReceiptsController(app.container);
  const tags = ['Facturas'];

  r.post(
    '/me/receipts',
    {
      preHandler: [app.authenticate, app.idempotent],
      config: { rateLimit: { max: 20, timeWindow: '1 day', keyGenerator: (req) => `receipts:${req.headers.authorization ?? req.ip}` } },
      schema: { tags, summary: 'Subir factura para escanear (multipart: file, storeId?)', consumes: ['multipart/form-data'] },
    },
    (req, rep) => c.upload(req, rep),
  );
  r.get('/me/receipts/:receiptId', { preHandler: [app.authenticate], schema: { tags, summary: 'Estado de una factura', params: ReceiptParams } }, (req) => c.get(req));
  r.get('/me/receipts/:receiptId/items', { preHandler: [app.authenticate], schema: { tags, summary: 'Líneas de la factura con su toggle «A mi despensa»', params: ReceiptParams } }, (req) => c.items(req));
  r.patch('/me/receipts/:receiptId/items/:itemId', { preHandler: [app.authenticate], schema: { tags, summary: 'Agregar o quitar una línea de la despensa', params: ReceiptItemParams, body: ReceiptItemBody } }, (req) =>
    c.reviewItem(req),
  );
}
