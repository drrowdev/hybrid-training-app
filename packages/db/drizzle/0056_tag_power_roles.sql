-- 0056_tag_power_roles.sql
--
-- Backfill `functional_roles` for every plyometric / Olympic movement
-- already in `public.movements`. The seed (`packages/db/seeds/movements-part3.ts`)
-- now sets these tags via the `plyo()` and `oly()` helpers, but
-- already-deployed environments seeded before that change carry empty
-- arrays on rows the earlier targeted migrations (0023, 0024) didn't
-- mention by slug.
--
-- This pass is pattern-driven (every plyometric → power_plyometric,
-- every olympic → power_olympic), so any future additions to those
-- families inherit the tag without a follow-up migration as long as
-- their pattern is correct.
--
-- Idempotent: each UPDATE checks for the tag's absence before appending,
-- so re-running is safe. `power_ballistic` is intentionally NOT touched
-- here — it's a per-slug override (loaded/explosive variants) and has
-- already been tagged by 0023 + 0024 on the deployed catalog.

UPDATE public.movements
SET functional_roles = array_append(coalesce(functional_roles, '{}'), 'power_plyometric')
WHERE pattern = 'plyometric' AND NOT ('power_plyometric' = ANY(coalesce(functional_roles, '{}')));

UPDATE public.movements
SET functional_roles = array_append(coalesce(functional_roles, '{}'), 'power_olympic')
WHERE pattern = 'olympic' AND NOT ('power_olympic' = ANY(coalesce(functional_roles, '{}')));
