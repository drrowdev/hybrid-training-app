-- 0043_bw_assessment.sql
--
-- Phase 2 of the bodyweight progression plan: onboarding wiring.
--
-- Adds a single bookkeeping column on `profiles` that records when
-- the user completed (or chose to skip with defaults) the three-page
-- assessment wizard that replaces the Training Maxes step for
-- bodyweight-only setups.
--
-- Why a separate timestamp rather than reusing `onboarded_at`:
--   * `onboarded_at` flips at the end of the *whole* wizard (after the
--     first block is created). The assessment runs much earlier and
--     can legitimately be re-opened from Settings → Bodyweight
--     progression to re-seed bw_progress without re-running the rest
--     of onboarding. A dedicated column lets the engine reason about
--     "has the user calibrated themselves at least once?" without
--     coupling it to first-block creation.
--   * Adding the column nullable + default NULL is safe to roll
--     forward: existing rows (bodyweight or not) get NULL until the
--     user actually walks through the assessment.
--
-- bw_progress rows are written by the server action that fires on
-- assessment submit; nothing in this migration touches that table.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bw_assessment_completed_at timestamptz;
