import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Cuenta: código de verificación al registrarse, exportación de datos y purga al borrar la cuenta. */
export class AccountObserver extends EventObserver {
  readonly name = 'account';

  constructor(c: Container) {
    super();
    const account = c.services.account;
    this.on('user.registered', async (e) => {
      if (e.payload.method !== 'password') return;
      await account.sendVerification(e.payload.userId, { enforceCooldown: false });
    });
    this.on('data_export.requested', (e) => account.buildExport(e.payload.userId, e.payload.exportId));
    this.on('user.deleted', (e) => account.purge(e.payload.userId, [...e.payload.storageKeys]));
  }
}
