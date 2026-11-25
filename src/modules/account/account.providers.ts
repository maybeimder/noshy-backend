import type { FastifyBaseLogger } from 'fastify';

/** Envío de correos transaccionales. El driver por defecto registra en el log. */
export type Mail = { to: string; subject: string; text: string; tag: 'emailVerification' | 'dataExport' };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class LogMailer implements Mailer {
  /** Últimos correos enviados (útil en desarrollo y pruebas). */
  readonly outbox: Mail[] = [];

  constructor(private readonly log: FastifyBaseLogger) {}

  async send(mail: Mail) {
    this.outbox.push(mail);
    if (this.outbox.length > 50) this.outbox.shift();
    this.log.info({ to: mail.to, subject: mail.subject, tag: mail.tag }, 'correo');
  }
}
