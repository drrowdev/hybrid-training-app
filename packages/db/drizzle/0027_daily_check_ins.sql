-- 0027_daily_check_ins.sql
--
-- Phase 3 polish — daily check-in surface (bodyweight + sleep + motivation)
-- and per-user feedback preferences (haptics, timer sound).
--
-- DESIGN NOTE (schema discipline, plan §6.8): the spec for this PR
-- asked for a new `daily_check_ins` table keyed `(user_id, date)` with
-- columns for bodyweight_kg / sleep_hours / motivation / notes. We
-- already have exactly that shape — `public.wellness` — created in
-- migration 0003. Rather than introduce a parallel table that would
-- collide with the existing bodyweight upsert path (see
-- `apps/web/src/lib/settings/actions.ts::logBodyweight`), we extend
-- `wellness` with the two missing columns and keep its unique key on
-- `(user_id, date)`. The public-facing server action is named
-- `recordDailyCheckIn` to match the spec; it writes through to
-- `wellness`. No data migration is needed — existing rows are valid
-- with NULL sleep_hours / motivation.
--
-- Two profile booleans (`haptics_enabled`, `timer_sound_enabled`) are
-- added to back the in-app settings toggles for haptic + audio feedback
-- (Phase 3 C1 + C2). Both default to TRUE — the existing rest-timer
-- already vibrates unconditionally.

------------------------------------------------------------
-- wellness — extend the daily check-in row.
------------------------------------------------------------

ALTER TABLE public.wellness
  ADD COLUMN IF NOT EXISTS sleep_hours numeric(3,1),
  ADD COLUMN IF NOT EXISTS motivation  smallint;

-- Range guards: sleep 0–24h, motivation 1–5 (matches fatigue/soreness
-- scale on `sessions`).
ALTER TABLE public.wellness
  DROP CONSTRAINT IF EXISTS wellness_sleep_hours_range;
ALTER TABLE public.wellness
  ADD CONSTRAINT wellness_sleep_hours_range
    CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24));

ALTER TABLE public.wellness
  DROP CONSTRAINT IF EXISTS wellness_motivation_range;
ALTER TABLE public.wellness
  ADD CONSTRAINT wellness_motivation_range
    CHECK (motivation IS NULL OR (motivation BETWEEN 1 AND 5));

-- The (user_id, date) unique index already exists from 0003. No new
-- RLS policy is required: `wellness_self` (`USING (user_id = auth.uid())`)
-- covers SELECT/INSERT/UPDATE/DELETE on the new columns.

------------------------------------------------------------
-- profiles — feedback toggles.
------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS haptics_enabled     boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS timer_sound_enabled boolean NOT NULL DEFAULT TRUE;
