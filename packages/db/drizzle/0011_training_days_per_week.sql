-- 0011_training_days_per_week.sql
-- Capture how many days per week the user can realistically train.
-- This shapes which archetype variants fit + drives the planner to drop
-- optional cardio days when the user can't accommodate them.

ALTER TABLE "profiles"
  ADD COLUMN "training_days_per_week" smallint NOT NULL DEFAULT 4
  CHECK ("training_days_per_week" BETWEEN 2 AND 7);

-- Per-block override (lets a user run a peaking block at higher frequency
-- than their normal weekly average, without changing the profile default).
ALTER TABLE "training_blocks"
  ADD COLUMN "days_per_week" smallint
  CHECK ("days_per_week" IS NULL OR "days_per_week" BETWEEN 2 AND 7);
