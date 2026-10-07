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
  },
  {
    id: '002_domain_tables',
    sql: `
      -- Ids en TEXT: los genera la app (randomUUID) y una URL con id inválido debe dar 404, no error de tipo.
      -- seq preserva el orden de inserción (los listados devuelven en el orden en que se crearon).
      CREATE TABLE users (
        id            TEXT        PRIMARY KEY,
        name          TEXT        NOT NULL,
        email         TEXT        NOT NULL UNIQUE,
        password_hash TEXT        NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE nutrition_plans (
        seq           BIGSERIAL,
        id            TEXT        PRIMARY KEY,
        user_id       TEXT        NOT NULL REFERENCES users (id),
        objective     TEXT        NOT NULL,
        targets       JSONB       NOT NULL,
        restrictions  JSONB       NOT NULL,
        meals_per_day INTEGER,
        created_at    TIMESTAMPTZ NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX nutrition_plans_user_idx ON nutrition_plans (user_id, seq);

      CREATE TABLE inventory_items (
        seq        BIGSERIAL,
        id         TEXT             PRIMARY KEY,
        user_id    TEXT             NOT NULL REFERENCES users (id),
        name       TEXT             NOT NULL,
        quantity   DOUBLE PRECISION NOT NULL,
        unit       TEXT             NOT NULL,
        created_at TIMESTAMPTZ      NOT NULL
      );
      CREATE INDEX inventory_items_user_idx ON inventory_items (user_id, seq);

      CREATE TABLE recipes (
        seq          BIGSERIAL,
        id           TEXT        PRIMARY KEY,
        user_id      TEXT        NOT NULL REFERENCES users (id),
        title        TEXT        NOT NULL,
        ingredients  JSONB       NOT NULL,
        instructions JSONB       NOT NULL,
        is_public    BOOLEAN     NOT NULL DEFAULT false,
        author_name  TEXT,
        published_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX recipes_user_idx ON recipes (user_id, seq);
      CREATE INDEX recipes_public_idx ON recipes (seq) WHERE is_public;

      CREATE TABLE preferences_documents (
        user_id    TEXT        PRIMARY KEY REFERENCES users (id),
        content    TEXT        NOT NULL,
        version    INTEGER     NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE chef_sessions (
        id                       TEXT        PRIMARY KEY,
        user_id                  TEXT        NOT NULL REFERENCES users (id),
        status                   TEXT        NOT NULL CHECK (status IN ('active', 'closed', 'recovery_pending')),
        base_preferences_version INTEGER     NOT NULL,
        preferences_version      INTEGER     NOT NULL,
        preferences_markdown     TEXT        NOT NULL,
        started_at               TIMESTAMPTZ NOT NULL,
        closed_at                TIMESTAMPTZ,
        close_reason             TEXT
      );
      CREATE INDEX chef_sessions_user_idx ON chef_sessions (user_id);

      CREATE TABLE chef_messages (
        seq        BIGSERIAL,
        id         TEXT        PRIMARY KEY,
        session_id TEXT        NOT NULL REFERENCES chef_sessions (id),
        user_id    TEXT        NOT NULL,
        role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
        content    TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX chef_messages_session_idx ON chef_messages (session_id, seq);

      CREATE TABLE feedback_entries (
        seq             BIGSERIAL,
        id              TEXT        PRIMARY KEY,
        user_id         TEXT        NOT NULL REFERENCES users (id),
        session_id      TEXT        NOT NULL REFERENCES chef_sessions (id),
        target_type     TEXT        NOT NULL,
        target_id       TEXT        NOT NULL,
        target_name     TEXT        NOT NULL,
        event_type      TEXT        NOT NULL,
        note            TEXT,
        idempotency_key TEXT,
        created_at      TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX feedback_entries_user_idx ON feedback_entries (user_id, seq);
      CREATE UNIQUE INDEX feedback_entries_idempotency_idx ON feedback_entries (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
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
