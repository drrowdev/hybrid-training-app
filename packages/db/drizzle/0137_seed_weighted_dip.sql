-- 0137_seed_weighted_dip.sql
-- ─────────────────────────────────────────────────────────────────────
-- Add the weighted dip to the global movement library, with its how-to.
--
-- The catalog already carries `weighted-pull-up` as its own movement rather
-- than as "pull-up, but loaded", so a lifter's weighted pull-up history and
-- loaded max are tracked separately from their bodyweight ones. The pressing
-- counterpart was missing: there was a Parallel Bar Dip and no weighted dip, so
-- searching the library for one found nothing.
--
-- The equipment tag is the BELT, not the bars. `requirementFromEquipmentTag`
-- matches by substring, and `dip-belt` is the only string that routes to the
-- lifter's tracked dip belt — the belt is the scarce item anyway, since a lifter
-- who owns one has somewhere to hang. A tag the resolver doesn't recognise
-- returns null and the slug heuristic takes over, which for this slug falls
-- through to `bodyweight_or_generic`: offered to every lifter, belt or no belt.
--
-- Idempotent, and additive only: no existing row is touched.

INSERT INTO public.movements (
  user_id,
  slug,
  display_name,
  pattern,
  primary_region,
  secondary_regions,
  primary_muscles,
  secondary_muscles,
  equipment,
  is_compound,
  interference_cost,
  high_strain_tendon,
  bulletproof_roles,
  functional_roles,
  is_supported,
  eccentric_load_score,
  stim_to_fatigue_score,
  axial_load,
  stability,
  bilateral,
  body_weight_loaded,
  experience_min,
  experience_max,
  metadata
) VALUES (
  NULL,
  'weighted-dip',
  'Weighted Dip',
  'press',
  'shoulder_scapular',
  '["elbow_forearm"]'::jsonb,
  '{"chest","triceps","front_delts"}'::muscle[],
  '{"side_delts"}'::muscle[],
  'dip-belt',
  true,
  'low',
  false,
  '{}'::text[],
  '{}'::text[],
  false,
  NULL,
  NULL,
  'low',
  'free',
  true,
  true,
  2,
  4,
  '{"cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"max-strength"}'::jsonb
)
ON CONFLICT (user_id, slug) DO UPDATE SET
  display_name = excluded.display_name,
  pattern = excluded.pattern,
  primary_region = excluded.primary_region,
  secondary_regions = excluded.secondary_regions,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  equipment = excluded.equipment,
  is_compound = excluded.is_compound,
  interference_cost = excluded.interference_cost,
  high_strain_tendon = excluded.high_strain_tendon,
  bulletproof_roles = excluded.bulletproof_roles,
  functional_roles = excluded.functional_roles,
  is_supported = excluded.is_supported,
  axial_load = excluded.axial_load,
  stability = excluded.stability,
  bilateral = excluded.bilateral,
  body_weight_loaded = excluded.body_weight_loaded,
  experience_min = excluded.experience_min,
  experience_max = excluded.experience_max,
  metadata = excluded.metadata;

INSERT INTO public.movement_instructions (
  movement_id,
  summary,
  setup,
  steps,
  cues,
  common_mistakes,
  source,
  reviewed,
  updated_at
)
SELECT
  id,
  'Parallel bar dip with load hung from a dip belt, trained as a heavy pressing lift.',
  'Hang the load from a dip belt, set the bars about shoulder-width, and support yourself at lockout with the shoulders down.',
  '["Take the load and stabilise at the top with elbows locked.","Lower under control until the upper arms reach about parallel with the floor.","Keep the load hanging still rather than swinging.","Press back to a full lockout."]'::jsonb,
  '["Keep a slight forward lean for chest, more upright for triceps.","Keep the shoulders pulled down away from the ears.","Stop at the depth your shoulders tolerate."]'::jsonb,
  '["Dropping into the bottom and bouncing out of it.","Letting the load swing and turn the set into a kip.","Going deeper than the shoulder can control just to add range."]'::jsonb,
  'seed-v1',
  true,
  now()
FROM public.movements
WHERE user_id IS NULL
  AND slug = 'weighted-dip'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;
