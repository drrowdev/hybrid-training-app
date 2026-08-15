-- 0128_set_logs_prescribed_snapshot.sql
--
-- ADR 0070 — capture prescribed-vs-actual on set_logs.
--
-- set_logs records what the user DID; it has never recorded what the app ASKED
-- for. Skips (0037) and swaps (engine_override_events) are audited overrides,
-- but "I did the set, 10 kg lighter" is indistinguishable from executing the
-- prescription as written. That is the DC-K4 gap this closes the data half of.
--
-- Shape (ADR 0070 §Decision):
--   target_weight_kg / target_reps — the numbers that were ON SCREEN. Typed and
--     top-level because they are externally observable (export, per-set history)
--     and compared numerically ("did this land as programmed?").
--   prescribed jsonb              — slot semantics a scalar cannot express:
--     required-vs-optional, set/rep ranges, effort target, AMRAP, percent+basis.
--     Engine-internal detail, so JSONB per schema discipline (plan §6.8).
--
-- NOT touched: `percent_of_tm` (migration 0003) stays unwritten. Its unit is
-- ambiguous (app percentTm is 0–100, engine percentOfTm is 0–1) and its NAME
-- asserts a TM basis that is wrong for Tactical Barbell / Green Protocol /
-- HYROX, which load off the 1RM. Percent + basis live in `prescribed` instead.
--
-- All columns are nullable with no backfill: historical rows cannot be honestly
-- reconstructed (the taper/recovery transform reorders and drops items, and TMs
-- have moved since). NULL means "unknown", and every consumer must degrade on
-- it. Additive + idempotent, so the online path is unchanged for existing rows.
--
-- RLS: set_logs policies are EXISTS-based via the parent session and are
-- unaffected by added columns. The existing `set_logs_has_some_work` CHECK
-- constrains actuals only and is likewise unaffected.

ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS target_weight_kg numeric(6, 2),
  ADD COLUMN IF NOT EXISTS target_reps      smallint,
  ADD COLUMN IF NOT EXISTS prescribed       jsonb;

COMMENT ON COLUMN public.set_logs.target_weight_kg IS
  'ADR 0070 — prescribed load as displayed at log time. NULL when unknown / not prescribed. Immutable after insert.';
COMMENT ON COLUMN public.set_logs.target_reps IS
  'ADR 0070 — prescribed reps as displayed at log time. NULL when unknown / not prescribed. Immutable after insert.';
COMMENT ON COLUMN public.set_logs.prescribed IS
  'ADR 0070 — prescription slot semantics at log time (optional, setRange, repRange, targetRir/Rpe, isAmrap, percentTm, basis). Immutable after insert.';

-- Targets are physical quantities; negatives are always a bug. Deliberately
-- permissive about zero (a bodyweight set legitimately prescribes 0 kg).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'set_logs_target_nonneg'
  ) THEN
    ALTER TABLE public.set_logs
      ADD CONSTRAINT set_logs_target_nonneg
      CHECK (
        (target_weight_kg IS NULL OR target_weight_kg >= 0)
        AND (target_reps IS NULL OR target_reps >= 0)
      );
  END IF;
END $$;

-- Immutability is enforced in the DATABASE, not by convention: RLS grants
-- authenticated users UPDATE on set_logs table-wide, so an edit path (or a
-- direct PostgREST call) could otherwise rewrite history. Editing a set changes
-- what you DID; it must never change what was ASKED.
--
-- Deliberately allows NULL -> value exactly once, so a backfill of a row logged
-- before its snapshot was resolvable can still land. value -> different value
-- and value -> NULL are both rejected.
CREATE OR REPLACE FUNCTION public.set_logs_freeze_prescribed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.target_weight_kg IS NOT NULL
     AND NEW.target_weight_kg IS DISTINCT FROM OLD.target_weight_kg THEN
    RAISE EXCEPTION 'set_logs.target_weight_kg is immutable (ADR 0070)';
  END IF;
  IF OLD.target_reps IS NOT NULL
     AND NEW.target_reps IS DISTINCT FROM OLD.target_reps THEN
    RAISE EXCEPTION 'set_logs.target_reps is immutable (ADR 0070)';
  END IF;
  IF OLD.prescribed IS NOT NULL
     AND NEW.prescribed IS DISTINCT FROM OLD.prescribed THEN
    RAISE EXCEPTION 'set_logs.prescribed is immutable (ADR 0070)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_logs_freeze_prescribed_trg ON public.set_logs;
CREATE TRIGGER set_logs_freeze_prescribed_trg
  BEFORE UPDATE ON public.set_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_logs_freeze_prescribed();
