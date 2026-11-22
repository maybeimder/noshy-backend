import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req, Rep } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import { Errors } from '../../../core/shared/errors.js';
import type { ReceiptItemBody, ReceiptItemParams, ReceiptParams } from './receipts.dto.js';

export class ReceiptsController {
  constructor(private readonly c: Container) {}

  upload = async (req: Req, reply: Rep) => {
    const file = await req.file();
    if (!file) throw Errors.validation([{ field: 'file', code: 'REQUIRED', message: 'Adjunta la foto o el PDF de la factura.' }]);
    const buffer = await file.toBuffer();
    const storeField = file.fields.storeId;
    const storeId = storeField && 'value' in storeField ? String(storeField.value) || null : null;
    reply.code(202);
    return ok(await this.c.services.receipts.upload(req.user.id, { buffer, contentType: file.mimetype }, storeId));
  };

  get = async (req: Req<{ Params: z.infer<typeof ReceiptParams> }>) => ok(await this.c.services.receipts.get(req.user.id, req.params.receiptId));

  items = async (req: Req<{ Params: z.infer<typeof ReceiptParams> }>) => ok(await this.c.services.receipts.items(req.user.id, req.params.receiptId));

  reviewItem = async (req: Req<{ Params: z.infer<typeof ReceiptItemParams>; Body: z.infer<typeof ReceiptItemBody> }>) =>
    ok(await this.c.services.receipts.reviewItem(req.user.id, req.tz, req.params.receiptId, req.params.itemId, req.body.addToPantry));
}
