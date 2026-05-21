-- 0014_sessions_two_a_day.sql
-- Adds session-slot support to enable AM + PM training on the same day.
--
-- Design context: docs/design/two-a-days.md
-- Encodes the behaviour required by DC-D1 (Robineau 2016 HIGH 6h gap),
-- DC-D2 (Coffey & Hawley 2017 HIGH same-day ordering), and DC-K4 (citation
-- surface).
--
-- The slot lives on planned_sessions (the planner is what places AM vs PM)
-- and is mirrored on sessions for freestyle logs + analytics. Existing rows
-- are backfilled to 'single' so the previous one-session-per-day shape is
-- preserved.

-- 1. Shared enum.
CREATE TYPE session_slot AS ENUM ('am', 'pm', 'single');

-- 2. planned_sessions: slot + planned_at (optional explicit start time).
ALTER TABLE public.planned_sessions
  ADD COLUMN IF NOT EXISTS slot session_slot NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS planned_at timestamptz;

-- Replace the (block, week, day) uniqueness with (block, week, day, slot)
-- so a single day can carry both an AM and a PM planned session.
-- The original constraint was auto-named by Drizzle as the table's unique
-- key, so we drop the constraint rather than a named index.
DROP INDEX IF EXISTS planned_sessions_block_week_day_unique_idx;
ALTER TABLE public.planned_sessions
  DROP CONSTRAINT IF EXISTS planned_sessions_block_id_week_index_day_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS planned_sessions_block_week_day_slot_unique_idx
  ON public.planned_sessions (block_id, week_index, day_index, slot);

-- 3. sessions: slot mirror + planned_at hint.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS slot session_slot NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS planned_at timestamptz;

-- 4. Profile-level default AM / PM windows. v1 default policy is to place
-- sessions inside these windows when planned_at is not explicitly set
-- (design doc §5 + §9 "defaults first" recommendation).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS am_window_start time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS am_window_end   time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS pm_window_start time NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS pm_window_end   time NOT NULL DEFAULT '19:00';
