-- 0057_movement_experience_bands.sql
--
-- PR W2 — proper experience tiering on the movement catalog (Option B
-- from `experience-tier-scope.md` §3). Adds an ordinal band `[min, max]`
-- to every movement so the four selection surfaces (accessory picker,
-- main-lift resolver, power-emphasis potentiation, cardio) can gate
-- candidates against the user's declared `training_experience`.
--
-- Tier scale (canonical — duplicated in `apps/web/src/lib/planner/experience-tier.ts`):
--   0 = beginner_lt_6m
--   1 = novice_6m_2y
--   2 = intermediate_2y_5y
--   3 = advanced_5y_10y
--   4 = highly_advanced_10y_plus
--
-- Defaults `(0, 4)` are intentional: existing rows aren't broken by the
-- migration. The follow-up data migration `0058_backfill_experience_bands.sql`
-- narrows bands per-slug to match the curated seed values.
--
-- DB-level CHECK guards the invariants (0..4, min ≤ max). Re-running the
-- migration is safe via IF NOT EXISTS on the columns; the constraint is
-- guarded with a manual existence check so re-applying doesn't blow up.

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS experience_min smallint NOT NULL DEFAULT 0;

ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS experience_max smallint NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movements_experience_band_chk'
  ) THEN
    ALTER TABLE public.movements
      ADD CONSTRAINT movements_experience_band_chk
      CHECK (experience_min >= 0 AND experience_max <= 4 AND experience_min <= experience_max);
  END IF;
END$$;
