-- 0077_prescription_modifications.sql
--
-- Audit + state log for engine-level prescription modifications driven
-- by the pre-race taper opt-in and the post-race recovery banner. Each
-- row is the snapshot of an "apply" / "decline" / "revert" decision the
-- user took on a recommended modification. The engine reads only rows
-- with status = 'applied' that span the target date and applies their
-- payload during prescription assembly (lib/planner/modifications.ts).
--
-- Why a snapshot?
--   The taper computation in lib/planner/taper.ts is deterministic from
--   (event_date, today) — but if we recomputed at render time, an Undo
--   could not faithfully reverse a prior Apply when the user crosses a
--   threshold (14d → 7d → 3d) between the two clicks. Snapshotting the
--   day-by-day window in `payload` makes Apply / Undo a clean pair and
--   lets us re-prompt with a fresh row at each new threshold.
--
-- RLS: only the row owner can SELECT. Inserts and updates are always
-- routed through server actions that use the user-scoped Supabase
-- client; the policy below covers reads only because the service role
-- (`auth.uid()` is null) bypasses RLS for writes via GRANTs.

CREATE TABLE IF NOT EXISTS public.prescription_modifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id            uuid REFERENCES public.priority_events(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('taper','recovery','user_override')),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  ramp_end_date       date,
  payload             jsonb NOT NULL,
  status              text NOT NULL CHECK (status IN ('applied','declined','reverted')),
  applied_at          timestamptz NOT NULL DEFAULT now(),
  reverted_at         timestamptz,
  CONSTRAINT prescription_modifications_dates_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS prescription_modifications_user_active_idx
  ON public.prescription_modifications (user_id, start_date, end_date)
  WHERE status = 'applied';

ALTER TABLE public.prescription_modifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select own modifications" ON public.prescription_modifications;
CREATE POLICY "select own modifications"
  ON public.prescription_modifications FOR SELECT
  USING (user_id = auth.uid());

REVOKE ALL ON public.prescription_modifications FROM PUBLIC;
REVOKE ALL ON public.prescription_modifications FROM anon;
GRANT SELECT ON public.prescription_modifications TO authenticated;
GRANT ALL ON public.prescription_modifications TO service_role;
