-- 0070_limitations_v2_lifecycle.sql
--
-- Limitations v2 — three product asks consolidated into one PR:
--
--   1. Drop `expected_duration_days`. The user explicitly rejected
--      duration estimates as a concept — "I don't know when this
--      will get better and a guess just rots in the table."
--
--   2. Add `affected_side` ('left' | 'right' | 'bilateral' | NULL).
--      Informational + future-trend data for now: the engine still
--      drops bilateral movements regardless of side (a barbell squat
--      loads both adductors, so it filters when adductors are blocked
--      even if the user picked left-only). UI surfaces the toggle so
--      the user can capture richer pain history; the engine ignores
--      it at this stage.
--
--   3. Add `allowed_movement_ids` — per-exercise allow-list,
--      user-asserted "I can still do this one without pain." The
--      muscle-level filter introduced in this PR drops movements where
--      a blocked muscle is primary OR secondary, except for movements
--      explicitly allowed here.
--
-- Plus a new `limitation_events` audit table — every transition
-- (started / resolved / reopened) lands a row. Backfilled from
-- existing limitations.created_at + resolved_at so the timeline isn't
-- blank for legacy data.

-- ─────────────────────────────────────────────────────────────────────
-- 1) limitations column changes
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.limitations
  DROP CONSTRAINT IF EXISTS limitations_expected_duration_days_nonneg;

ALTER TABLE public.limitations
  DROP COLUMN IF EXISTS expected_duration_days;

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS affected_side text
    CHECK (affected_side IS NULL OR affected_side IN ('left', 'right', 'bilateral'));

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS allowed_movement_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS limitations_allowed_movement_ids_gin_idx
  ON public.limitations USING GIN (allowed_movement_ids)
  WHERE resolved_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) limitation_events — append-only audit log
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.limitation_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  limitation_id uuid NOT NULL REFERENCES public.limitations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('started', 'resolved', 'reopened')),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS limitation_events_limitation_id_idx
  ON public.limitation_events (limitation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS limitation_events_user_idx
  ON public.limitation_events (user_id, occurred_at DESC);

-- RLS — standard self-owned pattern. Events are immutable: no UPDATE
-- policy. Deletes only happen via cascade from limitation delete; the
-- explicit DELETE policy is here because cascade still respects RLS
-- on some Postgres versions and we don't want the cascade to silently
-- leave orphans.
ALTER TABLE public.limitation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS limitation_events_select_self ON public.limitation_events;
CREATE POLICY limitation_events_select_self
  ON public.limitation_events
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS limitation_events_insert_self ON public.limitation_events;
CREATE POLICY limitation_events_insert_self
  ON public.limitation_events
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS limitation_events_delete_self ON public.limitation_events;
CREATE POLICY limitation_events_delete_self
  ON public.limitation_events
  FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE
  ON public.limitation_events
  TO authenticated;

GRANT SELECT, INSERT, DELETE, UPDATE
  ON public.limitation_events
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Backfill — synthetic 'started' / 'resolved' events for every
--    pre-existing limitation so the timeline isn't blank for legacy
--    data. Service-role bypasses RLS for this migration.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.limitation_events (limitation_id, user_id, kind, occurred_at)
SELECT id, user_id, 'started', created_at
  FROM public.limitations;

INSERT INTO public.limitation_events (limitation_id, user_id, kind, occurred_at)
SELECT id, user_id, 'resolved', resolved_at
  FROM public.limitations
 WHERE resolved_at IS NOT NULL;
