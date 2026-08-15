-- Rollback for 0128_set_logs_prescribed_snapshot.sql (ADR 0070).
--
-- ORDERING REQUIREMENT: deploy the application rollback FIRST, then run this.
-- During a rolling deploy a still-running instance writes these columns; the
-- trigger and columns must outlive the last writer, or inserts start failing.
--
-- This is a LOSSY rollback. Snapshots captured while the feature was live are
-- discarded and cannot be reconstructed (see the no-backfill rationale in the
-- forward migration). That is acceptable only because every consumer treats
-- NULL as "unknown" — re-applying 0128 leaves the columns empty until new sets
-- are logged.
--
-- Deliberately does NOT touch `percent_of_tm`: that column predates this work
-- (migration 0003) and is not ours to remove. 0128 never wrote to it.

DROP TRIGGER IF EXISTS set_logs_freeze_prescribed_trg ON public.set_logs;
DROP FUNCTION IF EXISTS public.set_logs_freeze_prescribed();

ALTER TABLE public.set_logs
  DROP CONSTRAINT IF EXISTS set_logs_target_nonneg;

ALTER TABLE public.set_logs
  DROP COLUMN IF EXISTS target_weight_kg,
  DROP COLUMN IF EXISTS target_reps,
  DROP COLUMN IF EXISTS prescribed;
