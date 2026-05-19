-- 0004_body_comp_phase.sql
-- Add body composition phase to profiles (DC-F11 + DC-Q2).
-- Engine uses this to adjust hypertrophy ceiling and intensity caps
-- when the user is in a declared cut/bulk phase.

CREATE TYPE "public"."body_comp_phase" AS ENUM ('gain', 'maintain', 'lean_out');

ALTER TABLE "profiles"
  ADD COLUMN "body_comp_phase" "body_comp_phase" DEFAULT 'maintain' NOT NULL,
  ADD COLUMN "phase_started_at" date,
  ADD COLUMN "phase_target_weeks" smallint
    CHECK (phase_target_weeks IS NULL OR phase_target_weeks BETWEEN 1 AND 52);
