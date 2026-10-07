import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DomainEvent } from '../../core/events/domain-event';
import {
  StreamVersionConflictError,
  type Outbox,
  type OutboxMessage,
  type OutboxStatus,
  type PersistentEventStore,
  type StoredEvent
} from '../../core/events/event-store';
import { withTransaction, type DbClient } from './db.connection';

type EventRow = {
  event_id: string;
  stream_id: string;
  version: number;
  type: string;
  payload: unknown;
  occurred_at: Date;
};

type OutboxRow = EventRow & {
  id: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  dispatched_at: Date | null;
};

const toStoredEvent = (row: EventRow): StoredEvent => ({
  eventId: row.event_id,
  streamId: row.stream_id,
  version: row.version,
  type: row.type,
  payload: row.payload,
  occurredAt: row.occurred_at.toISOString()
});

const UNIQUE_VIOLATION = '23505';

// Event Store + Outbox sobre Postgres. Los INSERT de eventos y de outbox van en la MISMA transacción:
// si el caso de uso pasa su `tx`, también comparten transacción con el cambio de estado.
export class PostgresEventStore implements PersistentEventStore<DbClient>, Outbox {
  constructor(private readonly pool: Pool) {}

  append(events: DomainEvent<any>[], tx?: DbClient): Promise<StoredEvent[]> {
    return tx ? this.appendWith(tx, events) : withTransaction(this.pool, (client) => this.appendWith(client, events));
  }

  async readStream(streamId: string): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query<EventRow>('SELECT * FROM event_store WHERE stream_id = $1 ORDER BY version', [streamId]);
    return rows.map(toStoredEvent);
  }

  async readAll(): Promise<StoredEvent[]> {
    const { rows } = await this.pool.query<EventRow>('SELECT * FROM event_store ORDER BY global_position');
    return rows.map(toStoredEvent);
  }

  async pending(limit = 100): Promise<OutboxMessage[]> {
    const { rows } = await this.pool.query<OutboxRow>(
      `SELECT o.id, o.status, o.attempts, o.last_error, o.created_at, o.dispatched_at,
              e.event_id, e.stream_id, e.version, e.type, e.payload, e.occurred_at
         FROM outbox o
         JOIN event_store e ON e.event_id = o.event_id
        WHERE o.status = 'pending'
        ORDER BY e.global_position
        LIMIT $1`,
      [limit]
    );
    return rows.map((row) => ({
      id: row.id,
      event: toStoredEvent(row),
      status: row.status,
      attempts: row.attempts,
      ...(row.last_error ? { lastError: row.last_error } : {}),
      createdAt: row.created_at.toISOString(),
      ...(row.dispatched_at ? { dispatchedAt: row.dispatched_at.toISOString() } : {})
    }));
  }

  async markDispatched(messageId: string): Promise<void> {
    await this.pool.query(`UPDATE outbox SET status = 'dispatched', dispatched_at = now() WHERE id = $1`, [messageId]);
  }

  async markFailed(messageId: string, error: string, maxAttempts: number): Promise<void> {
    await this.pool.query(
      `UPDATE outbox
          SET attempts = attempts + 1,
              last_error = $2,
              status = CASE WHEN attempts + 1 >= $3 THEN 'dead' ELSE status END
        WHERE id = $1`,
      [messageId, error, maxAttempts]
    );
  }

  private async appendWith(client: DbClient, events: DomainEvent<any>[]): Promise<StoredEvent[]> {
    const nextVersion = new Map<string, number>();
    const stored: StoredEvent[] = [];

    for (const event of events) {
      const streamId = event.userId;
      let version = nextVersion.get(streamId);
      if (version === undefined) {
        const { rows } = await client.query<{ max: number | null }>('SELECT MAX(version) AS max FROM event_store WHERE stream_id = $1', [streamId]);
        version = rows[0].max ?? 0;
      }
      version += 1;
      nextVersion.set(streamId, version);

      try {
        await client.query(
          `INSERT INTO event_store (event_id, stream_id, version, type, payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [event.eventId, streamId, version, event.name, JSON.stringify(event.payload), event.occurredAt]
        );
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw new StreamVersionConflictError(streamId);
        throw error;
      }
      await client.query('INSERT INTO outbox (id, event_id) VALUES ($1, $2)', [randomUUID(), event.eventId]);

      stored.push({
        eventId: event.eventId,
        streamId,
        version,
        type: event.name,
        payload: structuredClone(event.payload),
        occurredAt: event.occurredAt
      });
    }
    return stored;
  }
}
