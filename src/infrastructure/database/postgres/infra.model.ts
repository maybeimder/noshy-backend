import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, bigserial, timestamp, jsonb, primaryKey, index, unique } from 'drizzle-orm/pg-core';

/** Respuestas guardadas por `Idempotency-Key` (por usuario y ruta). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: text().notNull(),
    key: text().notNull(),
    route: text().notNull(),
    statusCode: integer(),
    response: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key, t.route] })],
);

/**
 * Event store: historial append-only de todos los eventos de dominio (fuente de verdad para replays).
 * Un stream por usuario; `version` es la posición dentro del stream y `globalPosition` el orden total.
 * Un trigger impide los UPDATE (ver migración 0002); solo se borra al purgar una cuenta.
 */
export const eventStore = pgTable(
  'event_store',
  {
    globalPosition: bigserial({ mode: 'number' }).primaryKey(),
    eventId: text().notNull().unique(),
    streamId: text().notNull(),
    version: integer().notNull(),
    type: text().notNull(),
    userId: text(),
    payload: jsonb().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('event_store_stream_version_uq').on(t.streamId, t.version), index('event_store_type_idx').on(t.type, t.globalPosition)],
);

/**
 * Outbox transaccional: una entrega pendiente por evento, escrita en la misma transacción que el evento
 * (y que el cambio de estado). El relay la lee y publica en RabbitMQ.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: text().primaryKey(),
    eventId: text()
      .notNull()
      .unique()
      .references(() => eventStore.eventId, { onDelete: 'cascade' }),
    streamId: text().notNull(),
    position: bigint({ mode: 'number' }).notNull(),
    status: text({ enum: ['pending', 'dispatched', 'dead'] }).notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('outbox_pending_idx').on(t.position).where(sql`status = 'pending'`), index('outbox_stream_idx').on(t.streamId, t.position)],
);

/** Qué observer ya procesó qué evento: la entrega es at-least-once y esto hace idempotentes a los observers. */
export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: text().notNull(),
    handler: text().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.handler] })],
);
