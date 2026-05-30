-- 0079_training_blocks_focus_muscles.sql
--
-- Per-block "focus muscle groups" ? user picks up to 2 muscle groups
-- per block; the engine biases accessory selection toward those
-- muscles using the substitution-with-cap model (no additive load;
-- non-focus aesthetic accessories scale down so total set count stays
-- constant). Block-scoped, not user-scoped ? different blocks can
-- have different focus.
--
-- See `apps/web/src/lib/planner/actions.ts` (defaultMuscleTargets) for
-- the engine integration, and CP-2 constraint row "focus-muscle bias"
-- in `hybrid-training-design-constraints.md` for the substitution
-- invariant + forearm tendon-gate rationale.
--
-- Two CHECK constraints:
--   1) max 2 entries ? practitioner consensus, 3+ focus areas dilute
--      the bias to the point it's indistinguishable from baseline.
--   2) allowlist of 12 aesthetic / specialisable muscle groups ?
--      excludes abs/core, lower back, hip flexors, adductors (injury
--      risk or not appropriate as bias targets).
--
-- Note on naming: the allowlist uses `side_delts` to match the
-- canonical `movements.primary_muscle` enum and the `LANDMARKS` table
-- in `apps/web/src/lib/stats/muscle-volume.ts`. The UI labels this
-- "Medial delts" per the practitioner-language brief.
--
-- Default `'{}'` = no focus ? engine produces the pre-PR baseline
-- exactly. No backfill ? existing blocks unchanged.
ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS focus_muscles text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_focus_muscles_size_chk;
ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_focus_muscles_size_chk
    CHECK (array_length(focus_muscles, 1) IS NULL OR array_length(focus_muscles, 1) <= 2);

ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_focus_muscles_allowlist_chk;
ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_focus_muscles_allowlist_chk
    CHECK (focus_muscles <@ ARRAY[
      'biceps','triceps','side_delts','rear_delts','front_delts',
      'calves','glutes','upper_chest','traps','forearms','quads','hamstrings'
    ]::text[]);