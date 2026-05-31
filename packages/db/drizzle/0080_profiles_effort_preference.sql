-- 0080_profiles_effort_preference.sql
--
-- ADR 0016 — user-facing effort / volume dial for the hypertrophy archetype.
--
-- A single user-level enum that scales BOTH axes of a hypertrophy block at
-- block-creation time:
--   - EFFORT axis: the hypertrophy compound early-set rep bump (ADR 0015) and
--     the final-set RIR anchor (ADR 0011). `high` pushes toward true RIR 1–3;
--     `low` reverts to plain fixed volume. The dial never prescribes RIR 0
--     (training to failure) on a concurrent-block compound.
--   - VOLUME axis: the aesthetic accessory sets-per-movement the dynamic
--     picker emits. `high` lifts effective weekly volume toward the 10–12
--     sets/muscle productive zone (Baz-Valle 2022); `low` trims it.
--
-- See `apps/web/src/lib/planner/effort-preference.ts` for the magnitudes and
-- CP-2 constraint row "effort/volume dial" in
-- `hybrid-training-design-constraints.md` for the calibration-policy framing.
--
-- DEFAULT 'standard' reproduces the pre-ADR-0016 prescription byte-for-byte,
-- so every existing row is unchanged and no backfill is needed. The dial is a
-- no-op for all non-hypertrophy archetypes. Generation-time only — changing it
-- never retro-edits an already-created block.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS effort_preference text NOT NULL DEFAULT 'standard';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_effort_preference_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_effort_preference_chk
    CHECK (effort_preference IN ('low', 'standard', 'high'));
