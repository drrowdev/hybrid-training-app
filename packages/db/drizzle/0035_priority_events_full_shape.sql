-- 0035_priority_events_full_shape.sql
--
-- Extend `priority_events` to capture the richer self-serve shape used
-- by the new /app/races page (PR — feat/races-page).
--
-- 0017 introduced the table with `id`, `user_id`, `name`, `event_date`,
-- `priority`, `modality` (free-text) and `notes`. That was enough for
-- the rule-based taper engine, but the new UI lets the user record a
-- target performance, capture the actual result, and mark events
-- complete. We also need an `updated_at` so the rows order
-- deterministically when shown in the history list.
--
--   * `target_performance` — modality-shaped jsonb. Loose by design:
--                            run targets carry `{ targetTime,
--                            targetDistanceKm, paceSecPerKm }`,
--                            strength carries `{ targetTotal, lifts }`,
--                            padel `{ targetRank }`, etc. The shape is
--                            authored client-side and never read by the
--                            engine — purely for display.
--   * `result`             — same loose shape, captured post-event.
--   * `completed`          — boolean toggle for "I did this". Defaults
--                            false; flipped from the CaptureResultModal
--                            or the inline complete toggle.
--   * `updated_at`         — set on every UPDATE via a trigger so the
--                            history list can break ties by edit time.
--
-- RLS: the 0017 `priority_events_self` policy already gates by
-- `user_id = auth.uid()` for every row, and the new columns inherit
-- that without further work.

ALTER TABLE public.priority_events
  ADD COLUMN IF NOT EXISTS target_performance jsonb;

ALTER TABLE public.priority_events
  ADD COLUMN IF NOT EXISTS result jsonb;

ALTER TABLE public.priority_events
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;

ALTER TABLE public.priority_events
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Auto-bump `updated_at` on every row update.
CREATE OR REPLACE FUNCTION public.priority_events_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS priority_events_set_updated_at ON public.priority_events;
CREATE TRIGGER priority_events_set_updated_at
  BEFORE UPDATE ON public.priority_events
  FOR EACH ROW EXECUTE FUNCTION public.priority_events_set_updated_at();
