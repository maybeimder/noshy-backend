import { randomUUID } from 'node:crypto';
import type { DomainEvent } from './domain-event';
import type { EventStore, Outbox, OutboxMessage, StoredEvent } from './event-store';

export class InMemoryEventStore implements EventStore, Outbox {
  private readonly events: StoredEvent[] = [];
  private readonly streams = new Map<string, StoredEvent[]>();
  private readonly outbox: OutboxMessage[] = [];

  // Eventos + outbox en un único paso síncrono: o quedan los dos o ninguno
  // (todo se construye primero y se confirma al final).
  append(events: DomainEvent<any>[]): StoredEvent[] {
    const lastVersion = new Map<string, number>();
    const records: StoredEvent[] = events.map((event) => {
      const streamId = event.userId;
      const version = (lastVersion.get(streamId) ?? this.streams.get(streamId)?.length ?? 0) + 1;
      lastVersion.set(streamId, version);
      return {
        eventId: event.eventId,
        streamId,
        version,
        type: event.name,
        // snapshot inmutable: los servicios siguen mutando sus objetos después de publicar
        payload: structuredClone(event.payload),
        occurredAt: event.occurredAt
      };
    });
    const messages: OutboxMessage[] = records.map((record) => ({
      id: randomUUID(),
      event: record,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString()
    }));

    // commit
    for (const record of records) {
      this.events.push(record);
      const stream = this.streams.get(record.streamId) ?? [];
      stream.push(record);
      this.streams.set(record.streamId, stream);
    }
    this.outbox.push(...messages);
    return records;
  }

  readStream(streamId: string): StoredEvent[] {
    return [...(this.streams.get(streamId) ?? [])];
  }

  readAll(): StoredEvent[] {
    return [...this.events];
  }

  async pending(limit = Number.POSITIVE_INFINITY): Promise<OutboxMessage[]> {
    return this.outbox.filter((message) => message.status === 'pending').slice(0, limit);
  }

  async markDispatched(messageId: string): Promise<void> {
    const message = this.find(messageId);
    message.status = 'dispatched';
    message.dispatchedAt = new Date().toISOString();
  }

  async markFailed(messageId: string, error: string, maxAttempts: number): Promise<void> {
    const message = this.find(messageId);
    message.attempts += 1;
    message.lastError = error;
    if (message.attempts >= maxAttempts) message.status = 'dead';
  }

  // Inspección (tests / métricas).
  outboxMessages(): readonly OutboxMessage[] {
    return this.outbox;
  }

  private find(messageId: string): OutboxMessage {
    const message = this.outbox.find((entry) => entry.id === messageId);
    if (!message) throw new Error(`Mensaje de outbox inexistente: ${messageId}`);
    return message;
  }
}
