-- 0082_training_blocks_goal_secondary_focus.sql
--
-- ADR 0020 — secondary-focus volume tilt.
--
-- The block wizard collects a PRIMARY goal and a SECONDARY focus, but until
-- now `wizardOutput` discarded both at submit (only archetype id + days/week
-- reached the server). The materialised block therefore ignored the secondary
-- entirely, and the wizard preview — which rendered a dedicated hypertrophy
-- day for "Strength + Muscle" — lied about what would actually be built.
--
-- These two nullable columns capture the user's wizard intent on the block so
-- the engine can act on the secondary (a bounded accessory-volume tilt, see
-- `apps/web/src/lib/planner/secondary-focus.ts`) and so the choice survives for
-- analytics / preview reconciliation.
--
-- Storage policy: we persist the RAW wizard channel values (not the collapsed
-- engine enum) to avoid information loss — e.g. a "resilience" or "skip"
-- secondary is preserved verbatim even though the v1 engine treats it as a
-- no-op. `resolveSecondaryFocus` collapses anything outside the tiltable set to
-- `none` at read time.
--
-- Both columns are NULLABLE with NO backfill: existing blocks (and any
-- legacy / custom-builder path that doesn't set them) read as NULL and produce
-- the pre-ADR-0020 baseline exactly — the engine-regression guarantee.
ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS goal text;

ALTER TABLE public.training_blocks
  ADD COLUMN IF NOT EXISTS secondary_focus text;

-- Bounded allowlists. `goal` mirrors the wizard `Goal` union; `secondary_focus`
-- mirrors the wizard `Secondary` union (`Goal | 'skip' | 'maintenance'`) plus
-- the engine-level `'none'` sentinel. NULL is always permitted (legacy blocks).
ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_goal_allowlist_chk;
ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_goal_allowlist_chk
    CHECK (goal IS NULL OR goal IN ('strength', 'muscle', 'cardio', 'resilience'));

ALTER TABLE public.training_blocks
  DROP CONSTRAINT IF EXISTS training_blocks_secondary_focus_allowlist_chk;
ALTER TABLE public.training_blocks
  ADD CONSTRAINT training_blocks_secondary_focus_allowlist_chk
    CHECK (secondary_focus IS NULL OR secondary_focus IN (
      'strength', 'muscle', 'cardio', 'resilience', 'skip', 'maintenance', 'none'
    ));
