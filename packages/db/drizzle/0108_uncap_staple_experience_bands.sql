-- 0108_uncap_staple_experience_bands.sql
--
-- Uncap four universal staples that PR W2's curated bands (0058) wrongly capped
-- at `experience_max = 2`, which DROPPED them from Advanced (3) and
-- Highly-advanced (4) athletes in the experience-gated selection surfaces:
--   - db-row-single-arm   (Single-Arm DB Row)   — universal back staple
--   - db-bench-flat        (DB Bench Press flat)  — universal press staple
--   - kb-swing-russian     (Russian KB Swing)     — universal posterior-chain staple
--   - goblet-squat         (Goblet Squat)         — fine accessory at any tier
--
-- Design principle (experience-tier-foreign-programs-design.md §0): experience
-- tier may only UNLOCK complexity, never STRIP a universal staple. Capping these
-- at intermediate violated that. Reset `experience_max = 4` so they're eligible
-- at every tier; selection still ranks staples on merit.
--
-- Scope: global seed movements (`user_id IS NULL`). Idempotent — re-running
-- writes the same value back. Mirrors the seed change in
-- `packages/db/seeds/movements-part1.ts`.
UPDATE public.movements
SET experience_max = 4
WHERE user_id IS NULL
  AND experience_max = 2
  AND slug IN (
    'db-row-single-arm',
    'db-bench-flat',
    'kb-swing-russian',
    'goblet-squat'
  );
