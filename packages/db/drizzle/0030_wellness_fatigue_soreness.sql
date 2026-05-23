-- 0030_wellness_fatigue_soreness.sql
--
-- Today-page redesign — extend the existing daily check-in row with
-- the 1–9 fatigue + soreness scale shown by HowRecoveredCard.
--
-- Why on `wellness` (not `sessions`):
--   `sessions.fatigue` / `sessions.soreness` are the pre-session 1–5
--   sliders from DC-P1 — keyed to a specific session. The new check-in
--   is a *day-level* reading independent of any session (the user can
--   log it on rest days too), so it belongs on the daily row alongside
--   bodyweight and motivation. Same (user_id, date) unique key from
--   migration 0003 keeps it idempotent.
--
-- Scale choice: 1–9 odd-numbered scale matches the UX mockup, which
-- shows only buttons {1,3,5,7,9}. The DB accepts any integer 1–9 so a
-- future denser scale ships without a migration.

ALTER TABLE public.wellness
  ADD COLUMN IF NOT EXISTS fatigue  smallint,
  ADD COLUMN IF NOT EXISTS soreness smallint;

ALTER TABLE public.wellness
  DROP CONSTRAINT IF EXISTS wellness_fatigue_range;
ALTER TABLE public.wellness
  ADD CONSTRAINT wellness_fatigue_range
    CHECK (fatigue IS NULL OR (fatigue BETWEEN 1 AND 9));

ALTER TABLE public.wellness
  DROP CONSTRAINT IF EXISTS wellness_soreness_range;
ALTER TABLE public.wellness
  ADD CONSTRAINT wellness_soreness_range
    CHECK (soreness IS NULL OR (soreness BETWEEN 1 AND 9));

-- No new RLS needed: `wellness_self` (USING user_id = auth.uid())
-- already covers SELECT/INSERT/UPDATE/DELETE on the new columns.
