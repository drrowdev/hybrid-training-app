-- 0032_training_maxes_source.sql
--
-- Make explicit *where* a training-max value came from. Until now the
-- `training_maxes.one_rm_kg` column carried no provenance — a user couldn't
-- tell whether the number was a deliberate entry or an estimate produced
-- by the engine from a recent heavy set. This migration adds source tags
-- so the UI can distinguish "(entered)" from "(e1RM · Epley)" without
-- guessing.
--
-- ## Schema additions
--
-- training_maxes
--   source                       text  default 'entered'
--   derived_from_session_id      uuid  → sessions(id)   ON DELETE SET NULL
--   derived_from_set_log_id      uuid  → set_logs(id)   ON DELETE SET NULL
--   derived_formula              text  ('epley' | 'brzycki' | 'rpe_zourdos')
--   derived_at                   timestamptz
--
-- A CHECK constraint enforces the source vocabulary. All existing rows are
-- backfilled as 'entered' (default), keeping behaviour unchanged.
--
-- ## New table — tm_suggestions
--
-- AMRAP-completion writes a *suggestion* row, never overwrites the user's
-- TM. The Today hero surfaces pending suggestions as a banner with
-- Accept / Dismiss. Status defaults to 'pending'. The accept path is what
-- actually writes back into training_maxes with source='derived_amrap'.

ALTER TABLE public.training_maxes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'entered',
  ADD COLUMN IF NOT EXISTS derived_from_session_id uuid
    REFERENCES public.sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derived_from_set_log_id uuid
    REFERENCES public.set_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derived_formula text,
  ADD COLUMN IF NOT EXISTS derived_at timestamptz;

ALTER TABLE public.training_maxes
  DROP CONSTRAINT IF EXISTS training_maxes_source_chk;
ALTER TABLE public.training_maxes
  ADD CONSTRAINT training_maxes_source_chk
  CHECK (source IN ('entered', 'derived_amrap', 'derived_rpe'));

ALTER TABLE public.training_maxes
  DROP CONSTRAINT IF EXISTS training_maxes_derived_formula_chk;
ALTER TABLE public.training_maxes
  ADD CONSTRAINT training_maxes_derived_formula_chk
  CHECK (
    derived_formula IS NULL
    OR derived_formula IN ('epley', 'brzycki', 'rpe_zourdos')
  );

-- ── tm_suggestions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tm_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  movement_id     uuid NOT NULL REFERENCES public.movements(id) ON DELETE CASCADE,
  current_tm_kg   numeric(6, 2),
  suggested_tm_kg numeric(6, 2) NOT NULL,
  source          text NOT NULL DEFAULT 'derived_amrap',
  derived_from_session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  derived_from_set_log_id uuid REFERENCES public.set_logs(id) ON DELETE SET NULL,
  derived_formula text,
  status          text NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT tm_suggestions_source_chk
    CHECK (source IN ('derived_amrap', 'derived_rpe')),
  CONSTRAINT tm_suggestions_status_chk
    CHECK (status IN ('pending', 'accepted', 'dismissed')),
  CONSTRAINT tm_suggestions_formula_chk
    CHECK (
      derived_formula IS NULL
      OR derived_formula IN ('epley', 'brzycki', 'rpe_zourdos')
    )
);

-- Look-up by user × movement, hot-path query is "any pending suggestion?".
CREATE INDEX IF NOT EXISTS tm_suggestions_user_status_idx
  ON public.tm_suggestions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS tm_suggestions_user_movement_idx
  ON public.tm_suggestions (user_id, movement_id);

-- Idempotency: a given session/set should never spawn two pending rows for
-- the same movement. Partial unique index — only constrains pending rows so
-- a user accepting and then re-AMRAPing the same set log is still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS tm_suggestions_pending_unique_idx
  ON public.tm_suggestions (user_id, movement_id, derived_from_set_log_id)
  WHERE status = 'pending' AND derived_from_set_log_id IS NOT NULL;

ALTER TABLE public.tm_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tm_suggestions_self ON public.tm_suggestions;
CREATE POLICY tm_suggestions_self
  ON public.tm_suggestions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tm_suggestions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tm_suggestions TO service_role;
