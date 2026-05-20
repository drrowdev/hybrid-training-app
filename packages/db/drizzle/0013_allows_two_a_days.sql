-- 0013_allows_two_a_days.sql
-- Capture the intent that a user is open to occasional two-a-day sessions
-- (typical hybrid pattern: AM strength + PM cardio, separated by ≥6h to
-- respect the AMPK/mTORC1 interference window from research-new).
-- Engine support for this signal is intentionally deferred; this column
-- only stores the user's preference so we don't lose it during onboarding.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allows_two_a_days boolean NOT NULL DEFAULT false;
