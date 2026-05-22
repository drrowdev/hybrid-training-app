-- 0023_power_movement_tagging.sql
-- Tag the seeded movement catalog with the three power functional roles
-- introduced for the wizard's "Add power emphasis" toggle:
--
--   power_olympic     — Olympic lift derivatives (triple-extension power)
--   power_plyometric  — jump-based stretch-shortening cycle work
--   power_ballistic   — loaded throws / explosive-intent variants
--
-- The accessory picker (apps/web/src/lib/planner/accessory-picker.ts)
-- biases toward movements carrying any of these tags when the block's
-- `power_emphasis` column is true. Other archetype paths are unaffected.
--
-- Tagging is additive (array_append) — never replaces an existing role.
-- Slugs are checked against the actual seed catalog
-- (packages/db/seeds/movements-part3.ts §oly + §plyo + a couple from
-- part1.ts). Proposed slugs that don't exist in the catalog are skipped
-- per scope guard (no new movement seeding in this PR).

-- ─── Functional: power_olympic ────────────────────────────────────
-- Triple-extension lifts. Hang-power-clean kept alongside hang-clean
-- because the seed catalog ships both — both are oly derivatives.
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_olympic')
WHERE slug IN (
  'power-clean',
  'hang-clean',
  'hang-power-clean',
  'clean-pull',
  'power-snatch',
  'hang-snatch',
  'snatch-pull',
  'push-press',
  'push-jerk'
)
AND NOT ('power_olympic' = ANY(functional_roles));

-- ─── Functional: power_plyometric ─────────────────────────────────
-- Jump-based SSC work. Includes lateral-hop (matches the "lateral_bound"
-- candidate in the proposal) + hill-bounds (bounding-based, sourced from
-- the run-drill family).
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_plyometric')
WHERE slug IN (
  'box-jump-low',
  'box-jump-high',
  'broad-jump',
  'depth-jump',
  'vertical-jump',
  'tuck-jump',
  'pogo-hop',
  'single-leg-bound',
  'lateral-hop',
  'hill-bounds'
)
AND NOT ('power_plyometric' = ANY(functional_roles));

-- ─── Functional: power_ballistic ──────────────────────────────────
-- Loaded throw / explosive-intent variants. KB swings count as ballistic
-- hip extension (both Russian and American variants are seeded).
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_ballistic')
WHERE slug IN (
  'kb-swing-russian',
  'kb-swing-american',
  'med-ball-slam',
  'med-ball-chest-pass',
  'med-ball-rotational-throw'
)
AND NOT ('power_ballistic' = ANY(functional_roles));
