-- 0092_tag_shoulder_stability_roles.sql
--
-- ADR 0035 — tag the rotator-cuff / scapular-care movements with the new
-- `shoulder_stability` functional role so the accessory picker can seat a
-- guaranteed cuff-prehab item for blocks with a pressing main lift.
--
-- These 8 `pattern:"cuff"` movements previously carried NO functional role
-- (they surfaced only as incidental rear-delt aesthetic work), so an OHP/bench
-- presser got no guaranteed shoulder prehab. `seeds/derive-roles.ts` now derives
-- `shoulder_stability` from `pattern === "cuff"`; this migration reconciles the
-- already-seeded prod rows to match. Idempotent (guarded append); global
-- (seed) movements only.

UPDATE public.movements
SET functional_roles = array_append(functional_roles, 'shoulder_stability')
WHERE user_id IS NULL
  AND slug IN (
    'external-rotation-cable',
    'external-rotation-band',
    'external-rotation-db',
    'internal-rotation-cable',
    'prone-y-raise',
    'prone-t-raise',
    'prone-w-raise',
    'scapular-pull-up'
  )
  AND NOT ('shoulder_stability' = ANY(functional_roles));
