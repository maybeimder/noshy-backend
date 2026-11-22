import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Factura subida → OCR e interpretación → `receipt.parsed` / `receipt.failed`. */
export class ReceiptsObserver extends EventObserver {
  readonly name = 'receipts';

  constructor(c: Container) {
    super();
    this.on('receipt.uploaded', async (e) => {
      const user = await c.repos.users.findById(e.payload.userId);
      await c.services.receipts.process(e.payload.receiptId, user?.timezone ?? 'America/Bogota');
    });
  }
}
