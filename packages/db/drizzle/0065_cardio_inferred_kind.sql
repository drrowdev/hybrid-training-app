-- 0065_cardio_inferred_kind.sql
--
-- Phase 2 of the "external cardio" feature. The Strava sync runs
-- `classifyCardio()` against each cardio_logs row (avg HR + max HR +
-- duration) and persists the result here so the engine and UI can
-- query it without re-running the classifier. See
-- `apps/web/src/lib/integrations/strava/classify-cardio.ts`.
--
-- inferred_kind values mirror the cardio_* `PrescriptionItemKind`s
-- (cardio_z2 / cardio_threshold / cardio_vo2 / cardio_alactic /
-- cardio_mixed). Left as plain `text` rather than an enum so the
-- classifier can evolve without a schema migration.
--
-- inferred_confidence is 0..1; the UI dims the badge when < 0.7.

ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS inferred_kind text;

ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS inferred_confidence numeric(3, 2);
