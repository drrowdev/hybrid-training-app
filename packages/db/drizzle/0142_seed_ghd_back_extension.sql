-- Seed the GHD back extension.
--
-- Distinct from `back-extension-45`, which is the angled hyperextension bench.
-- A glute-ham developer holds the torso HORIZONTAL, so the lever is longest at
-- the top and the range is larger — different apparatus, different strength
-- curve. Both belong in the catalogue; plenty of gyms have both.
--
-- Attributes are set explicitly rather than inherited. The seed's `hinge(...)`
-- helper is built around the deadlift and defaults to `secondary_regions`
-- including `knee` and `secondary_muscles` of lats/forearms/traps. Nothing is
-- held during a back extension and the knees are anchored rather than loaded,
-- and those columns drive limitation filtering, so cloning the helper's
-- defaults would mean an elbow or knee flag reaching a movement it has no
-- business touching.
--
-- The `ghd-machine` tag is deliberate and load-bearing beyond equipment
-- filtering: `isBodyweightCapableEquipment` treats every `machine` tag as
-- requiring an entered weight EXCEPT one containing `ghd`, so a GHD movement
-- tagged anything else would make the logger demand a load for an unweighted
-- set. (This is also why `back-extension-45`'s inaccurate `ghd-machine` tag is
-- left alone here: correcting it to a hyperextension-bench tag would break its
-- bodyweight logging, which needs its own coordinated change.)
--
-- Idempotent: upsert on (user_id, slug), matching the seed runner.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES
  (
    NULL, 'back-extension-ghd', 'GHD Back Extension', 'hinge', 'hamstring_posterior',
    '["lumbar_trunk"]'::jsonb,
    '{lower_back,glutes,hamstrings}'::muscle[], '{}'::muscle[],
    'ghd-machine', true, 'low', false,
    '{}'::text[], '{compound_assistance}'::text[], false,
    NULL, NULL,
    'moderate', 'supported', true, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"horizontal-lever"}'::jsonb
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
  eccentric_load_score = excluded.eccentric_load_score,
  stim_to_fatigue_score = excluded.stim_to_fatigue_score,
  axial_load = excluded.axial_load,
  stability = excluded.stability,
  bilateral = excluded.bilateral,
  body_weight_loaded = excluded.body_weight_loaded,
  experience_min = excluded.experience_min,
  experience_max = excluded.experience_max,
  metadata = excluded.metadata;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  id,
  'Hip extension on a glute-ham developer, torso horizontal at the top — a longer range than the 45° version.',
  'Face down on a GHD, hip pads just below the hip bones, feet locked between the rollers.',
  '["Let the torso fold down at the hips, keeping the back neutral.","Squeeze the glutes and hamstrings to raise back up to horizontal.","Stop level with the legs — don''t arch past straight."]'::jsonb,
  '["The movement is at the hips; the spine stays in one position.","Horizontal is the top of the rep, not a starting point for an arch."]'::jsonb,
  '["Arching the lower back at the top to gain height.","Setting the pads too high, which blocks the hinge."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'back-extension-ghd'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  updated_at = excluded.updated_at;
