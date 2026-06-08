-- 0093_tag_pull_roles.sql
--
-- ADR 0036 — tag every pulling movement with the new `pull` functional role so
-- the accessory picker can guarantee one weekly pull on EVERY archetype.
--
-- No main-lift pattern is a pull (the four are squat / horizontal_press /
-- deadlift / vertical_press), so without a guaranteed pulling accessory a block
-- can ship zero back/biceps volume. `seeds/derive-roles.ts` now derives `pull`
-- from `pattern === "pull"`; this migration reconciles the already-seeded prod
-- rows to match. Idempotent (guarded append); global (seed) movements only.

UPDATE public.movements
SET functional_roles = array_append(functional_roles, 'pull')
WHERE user_id IS NULL
  AND pattern = 'pull'
  AND NOT ('pull' = ANY(functional_roles));
