import type { Arg } from '../../../core/commands/command-bus.js';
import type { ReceiptsService } from '../receipts.service.js';

/** Comandos del módulo receipts. Facturas. */
export const receiptsCommands = (s: { receipts: ReceiptsService }) => ({
  'receipts.upload': (c: { userId: string; file: Arg<ReceiptsService['upload'], 1>; storeId: string | null }) => s.receipts.upload(c.userId, c.file, c.storeId),
  'receipts.reviewItem': (c: { userId: string; tz: string; receiptId: string; itemId: string; addToPantry: boolean }) => s.receipts.reviewItem(c.userId, c.tz, c.receiptId, c.itemId, c.addToPantry),
});
