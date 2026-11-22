-- Event store append-only + outbox ligado (Transactional Outbox). Reemplaza a outbox_events.
CREATE TABLE "event_store" (
	"global_position" bigserial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"user_id" text,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_store_eventId_unique" UNIQUE("event_id"),
	CONSTRAINT "event_store_stream_version_uq" UNIQUE("stream_id","version"),
	CONSTRAINT "event_store_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"stream_id" text NOT NULL,
	"position" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "outbox_eventId_unique" UNIQUE("event_id"),
	CONSTRAINT "outbox_status_check" CHECK ("status" IN ('pending', 'dispatched', 'dead'))
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_event_id_event_store_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_store"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Lo que hubiera en el outbox anterior pasa al event store (con versión por usuario) y lo no publicado, al outbox nuevo.
INSERT INTO "event_store" ("event_id", "stream_id", "version", "type", "user_id", "payload", "occurred_at")
SELECT "id", coalesce("user_id", 'system'),
       row_number() OVER (PARTITION BY coalesce("user_id", 'system') ORDER BY "occurred_at", "id"),
       "type", "user_id", "payload", "occurred_at"
FROM "outbox_events"
ORDER BY "occurred_at", "id";--> statement-breakpoint
INSERT INTO "outbox" ("id", "event_id", "stream_id", "position", "status", "dispatched_at")
SELECT 'obx_' || e."event_id", e."event_id", e."stream_id", e."global_position",
       CASE WHEN o."published_at" IS NULL THEN 'pending' ELSE 'dispatched' END, o."published_at"
FROM "event_store" e JOIN "outbox_events" o ON o."id" = e."event_id";--> statement-breakpoint
DROP TABLE "outbox_events" CASCADE;--> statement-breakpoint
CREATE INDEX "event_store_type_idx" ON "event_store" USING btree ("type","global_position");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("position") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_stream_idx" ON "outbox" USING btree ("stream_id","position");--> statement-breakpoint
-- Append-only: un evento guardado no se edita nunca. Solo se borra al purgar una cuenta (derecho al olvido).
CREATE FUNCTION "event_store_forbid_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'event_store es append-only: no se puede modificar el evento %', OLD.event_id;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "event_store_append_only" BEFORE UPDATE ON "event_store" FOR EACH ROW EXECUTE FUNCTION "event_store_forbid_update"();
