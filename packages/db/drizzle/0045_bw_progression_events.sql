-- 0045_bw_progression_events.sql
--
-- Phase 4 of the bodyweight progression plan: TUT-gated progression
-- engine. Adds the audit table that records every advance the
-- `evaluateProgression` engine writes — emitted from the session-
-- completion hook when the gate (weeks_at_node + accumulated TUT +
-- two sessions of over-completion) opens for a family.
--
-- Why a dedicated event table:
--   bw_progress.current_node_id only stores the latest pointer. The
--   user-facing "Recent progressions" list on the settings page, and
--   the diagnostic surface that Phase 6 (stall detection) will read
--   off, both need an append-only timeline of who jumped from where
--   to where and why. Keeping the audit out of bw_progress keeps the
--   pointer table small and lets the event row carry the reason
--   string ("over_completed_2_weeks" / "chip_preference") without
--   denormalising it onto every progress row.
--
-- Schema discipline (plan §6.8): every column drives a read — family
-- + from/to + reason render the row; user_id + occurred_at are the
-- index columns. No JSONB shovelware.
--
-- RLS: per-user. Engine + UI read via the user's own session; the
-- write path runs server-side under the user's auth context (the
-- session-completion server action), so the standard self-policy
-- shape is sufficient. No service-role write required.

CREATE TABLE IF NOT EXISTS public.bw_progression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family text NOT NULL,
  from_node_id uuid NOT NULL REFERENCES public.movement_nodes(id) ON DELETE RESTRICT,
  to_node_id uuid NOT NULL REFERENCES public.movement_nodes(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bw_progression_events_user_idx
  ON public.bw_progression_events(user_id, occurred_at DESC);

ALTER TABLE public.bw_progression_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_progression_events'
      AND policyname = 'bw_progression_events_self_read'
  ) THEN
    CREATE POLICY "bw_progression_events_self_read"
      ON public.bw_progression_events FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_progression_events'
      AND policyname = 'bw_progression_events_self_write'
  ) THEN
    CREATE POLICY "bw_progression_events_self_write"
      ON public.bw_progression_events FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
