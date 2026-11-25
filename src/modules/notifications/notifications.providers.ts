import type { FastifyBaseLogger } from 'fastify';

/** Push notifications. El driver por defecto solo deja el registro. */
export interface Notifier {
  push(userId: string, notification: { title: string; body: string; deepLink: string }): Promise<void>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: FastifyBaseLogger) {}
  async push(userId: string, n: { title: string; body: string; deepLink: string }) {
    this.log.info({ userId, ...n }, 'push');
  }
}
