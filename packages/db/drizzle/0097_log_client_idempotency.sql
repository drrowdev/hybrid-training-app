-- 0097_log_client_idempotency.sql
--
-- Offline-logging idempotency key (v1 offline logging). The client generates a
-- UUID per logged set / cardio block BEFORE the network write and persists it
-- in an IndexedDB outbox; the server upserts ON CONFLICT (client_log_id) DO
-- NOTHING so a retried flush (lost ACK over a flaky gym connection) can never
-- double-insert the same row.
--
-- Nullable + UNIQUE: legacy rows and the regular online write path leave it
-- NULL and coexist freely (Postgres treats NULLs as distinct, so a plain unique
-- index permits unlimited NULL rows), keeping the online path byte-identical.
-- A plain (non-partial) index is used so PostgREST/upsert ON CONFLICT inference
-- works without a predicate. Idempotent.

ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS client_log_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS set_logs_client_log_id_key
  ON public.set_logs (client_log_id);

ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS client_log_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_client_log_id_key
  ON public.cardio_logs (client_log_id);
