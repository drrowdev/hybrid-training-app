-- 0017_events.sql
-- Priority events (races, peaks, comps) per Phase 2 + new §6 taper logic.
--
-- Lets the user mark up to a few key dates so the planner can apply rule-
-- based taper suggestions inside a 14-day window (volume cut, intensity
-- hold) without needing AI.

CREATE TYPE event_priority AS ENUM ('A', 'B', 'C');

CREATE TABLE public.priority_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  event_date  date NOT NULL,
  priority    event_priority NOT NULL DEFAULT 'A',
  modality    text, -- 'strength' | 'endurance' | 'hybrid' | freeform
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX priority_events_user_date_idx
  ON public.priority_events (user_id, event_date);

ALTER TABLE public.priority_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY priority_events_self ON public.priority_events
  FOR ALL
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.priority_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.priority_events TO service_role;
