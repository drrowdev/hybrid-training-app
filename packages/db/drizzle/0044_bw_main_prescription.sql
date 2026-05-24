-- 0044_bw_main_prescription.sql
--
-- Phase 3 of the bodyweight progression plan: engine prescription for
-- bodyweight main lifts. No new table or column — the per-item
-- prescription shape (`PrescriptionItem`) already lives inside the
-- `planned_sessions.prescription` jsonb column, so the BW main-lift
-- payload travels through that existing channel.
--
-- This migration exists to:
--   1. Document the new variant (`PrescriptionItem.bw`) on the
--      prescription column so a future reader of the schema sees the
--      Phase 3 shape next to every other item kind.
--   2. Reserve the migration slot in the journal so Phase 4 (TUT-gated
--      progression engine) lands as 0045 with a clear lineage.
--
-- See:
--   - apps/web/src/lib/planner/bw-prescription.ts — matrix logic.
--   - packages/db/src/schema/planner.ts — typed PrescriptionItem.
--
-- The `IS NOT DISTINCT FROM` guard makes this idempotent: re-running
-- the migration after a manual COMMENT edit won't fail on a mismatch.

COMMENT ON COLUMN planned_sessions.prescription IS
  'Per-day prescription payload. Array of PrescriptionItem objects (see packages/db/src/schema/planner.ts). Item kinds: warmup / main / back_off / accessory / tendon / power_potentiation / cardio_*. Bodyweight main lifts carry a `bw` block with the prescription matrix output (sets, reps or holdSeconds, RIR, tempo, rest, cue, notes) keyed off the user''s current movement_nodes row for that family — see apps/web/src/lib/planner/bw-prescription.ts.';
