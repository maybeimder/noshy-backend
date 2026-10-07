import type { Pool } from 'pg';
import { withTransaction } from './db.connection';

// Migraciones en orden. Nunca edites una ya aplicada: agrega una nueva al final.
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_event_store_and_outbox',
    sql: `
      -- Event Sourcing: historial append-only. global_position da el orden total.
      CREATE TABLE event_store (
        global_position BIGSERIAL PRIMARY KEY,
        event_id        UUID        NOT NULL UNIQUE,
        stream_id       TEXT        NOT NULL,
        version         INTEGER     NOT NULL,
        type            TEXT        NOT NULL,
        payload         JSONB       NOT NULL,
        occurred_at     TIMESTAMPTZ NOT NULL,
        recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- concurrencia optimista: dos escrituras no pueden tomar la misma versión del stream
        CONSTRAINT event_store_stream_version_unique UNIQUE (stream_id, version)
      );

      -- Transactional Outbox: una entrega pendiente por evento, escrita en la misma transacción.
      CREATE TABLE outbox (
        id            UUID        PRIMARY KEY,
        event_id      UUID        NOT NULL REFERENCES event_store (event_id),
        status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'dead')),
        attempts      INTEGER     NOT NULL DEFAULT 0,
        last_error    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        dispatched_at TIMESTAMPTZ
      );
      CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE status = 'pending';

      -- Idempotencia de mensajes entrantes (RabbitMQ messageId).
      CREATE TABLE processed_messages (
        message_id   TEXT        PRIMARY KEY,
        handler      TEXT        NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `
  }
];

// Aplica las migraciones pendientes. Un advisory lock evita que dos procesos migren a la vez.
export async function runMigrations(pool: Pool): Promise<string[]> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(424242)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.id));

    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      newlyApplied.push(migration.id);
    }
    return newlyApplied;
  });
}
