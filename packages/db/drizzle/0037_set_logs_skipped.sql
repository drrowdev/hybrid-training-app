-- 0037_set_logs_skipped.sql
--
-- Per-set skip with reason — surface change in the session logging UX.
--
-- The logger now lets users skip a prescribed set with a one-tap reason
-- chip (pain / fatigue / time / equipment / other). Skips are first-
-- class set_logs rows so the rest of the session machinery (cursor
-- advance, "covered" check on the movement card, dot strip) treats
-- them on equal footing with logged sets — but they explicitly do NOT
-- count as work for tonnage, PRs, or e1RM.
--
-- We add two columns:
--   * `skipped`     boolean NOT NULL DEFAULT false — the discriminator
--                   read by every load-summing query (.eq('skipped',
--                   false) to exclude).
--   * `skip_reason` text  NULL — one of a small allowlist when not
--                   null. CHECK constraint keeps the picker chips and
--                   the analytics buckets in lockstep.
--
-- Backfill: nothing to do — every existing row is non-skipped by
-- definition (the column didn't exist before this migration).
--
-- RLS: inherits the existing `set_logs_self` policy through the
-- session_id → sessions.user_id join; no policy edits needed.
ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;

ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS skip_reason text;

-- Allowlist of reasons. Null is fine (non-skipped rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'set_logs_skip_reason_chk'
      AND conrelid = 'public.set_logs'::regclass
  ) THEN
    ALTER TABLE public.set_logs
      ADD CONSTRAINT set_logs_skip_reason_chk
      CHECK (
        skip_reason IS NULL OR
        skip_reason IN ('pain','fatigue','time','equipment','other')
      );
  END IF;
END$$;

-- Helpful partial index for the engine queries that filter out skipped
-- rows when summing tonnage / bucket pressure.
CREATE INDEX IF NOT EXISTS set_logs_session_active_idx
  ON public.set_logs (session_id)
  WHERE skipped = false;
