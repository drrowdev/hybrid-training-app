-- 0075_strava_event_log.sql
-- Idempotency log for Strava push webhook deliveries.
--
-- Strava delivers webhook events with at-least-once semantics — a
-- single activity create can produce multiple POSTs (network retry,
-- subscription re-delivery, manual replay). We dedupe on the tuple
-- (subscription_id, event_time, object_id, aspect_type) by inserting
-- a row in this table BEFORE running the handler; the unique index
-- below makes the second insert fail fast so we return 200 silently
-- without re-syncing.
--
-- Security model: Strava webhook deliveries are NOT signed. The
-- transport guard is the `verify_token` returned during subscription
-- creation (checked on the GET handshake) plus `subscription_id`
-- equality on every POST. RLS is enabled with no SELECT grant to
-- authenticated users — only the service role (server route handler)
-- reads / writes this table.

CREATE TABLE IF NOT EXISTS public.strava_event_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id bigint NOT NULL,
  event_time      bigint NOT NULL,
  object_id       bigint NOT NULL,
  object_type     text NOT NULL,
  aspect_type     text NOT NULL,
  owner_id        bigint NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_ok    boolean NOT NULL DEFAULT false,
  error           text
);

CREATE UNIQUE INDEX IF NOT EXISTS strava_event_log_dedup
  ON public.strava_event_log (subscription_id, event_time, object_id, aspect_type);

CREATE INDEX IF NOT EXISTS strava_event_log_owner_idx
  ON public.strava_event_log (owner_id, received_at DESC);

ALTER TABLE public.strava_event_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.strava_event_log FROM PUBLIC;
REVOKE ALL ON public.strava_event_log FROM anon;
REVOKE ALL ON public.strava_event_log FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.strava_event_log TO service_role;
