import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import { processedEvents } from '../../infrastructure/database/postgres/infra.model.js';

/**
 * Registro de qué observer ya procesó qué evento. RabbitMQ y el relay entregan at-least-once,
 * así que un evento puede llegar dos veces; con esto cada observer lo aplica una sola vez,
 * aunque el proceso se caiga a la mitad o el mensaje vuelva por un reintento.
 */
export class ProcessedEventsLedger {
  constructor(private readonly db: Db) {}

  async done(eventId: string, observers: readonly string[]): Promise<Set<string>> {
    if (observers.length === 0) return new Set();
    const rows = await this.db
      .select({ handler: processedEvents.handler })
      .from(processedEvents)
      .where(and(eq(processedEvents.eventId, eventId), inArray(processedEvents.handler, [...observers])));
    return new Set(rows.map((r) => r.handler));
  }

  async mark(eventId: string, observer: string): Promise<void> {
    await this.db.insert(processedEvents).values({ eventId, handler: observer }).onConflictDoNothing();
  }
}
