-- Seed the sliding leg curl.
--
-- The catalogue had three machine leg curls (`leg-curl-lying`, `leg-curl-seated`,
-- `leg-curl-single`) and the Nordic family, but nothing between them: no
-- hamstring curl for a lifter with neither a machine nor an anchor. This is the
-- supine slider curl — heels on sliders, hips bridged, legs extend out and curl
-- back in.
--
-- Two catalogue decisions worth recording:
--
--   * `emphasis` avoids the words "strain-prevention". `deriveAccessoryRoles()`
--     matches that phrase and adds `alfredson_eccentric`, which is the
--     symptomatic-only rehab protocol (DC-O4 floor weight 0, excluded from
--     direct focus work). The Nordic legitimately carries that role; a general
--     accessory must not, or it is filed as injury work and never picked
--     normally. Roles below are therefore empty, matching what the TypeScript
--     seed derives.
--
--   * Eccentric demand is declared in `eccentric_load_score`, the first-class
--     column the picker reads to demote heavy-eccentric work under concurrent
--     stress. `metadata.eccentric_cost` is descriptive only and would have had
--     no effect.
--
-- The sliders are not modelled: the equipment inventory has no slider field, so
-- a `sliders` tag would filter nothing while implying precision it doesn't have.
-- The tag is plain `bodyweight` and the requirement is named in the setup text.
-- Note that a slug containing `leg-curl` is read by the planner's slug heuristic
-- as requiring a leg-curl MACHINE; `resolveRequiredEquipment` now refuses to let
-- a bodyweight tag be overruled into a facility requirement, and a test pins it.
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
    NULL, 'sliding-leg-curl', 'Sliding Leg Curl', 'isolation', 'hamstring_posterior',
    '[]'::jsonb,
    '{hamstrings}'::muscle[], '{glutes}'::muscle[],
    'bodyweight', false, 'low', false,
    '{}'::text[], '{}'::text[], false,
    4, NULL,
    'low', 'free', true, false, 0, 4,
    '{"stim_fatigue_ratio":"high","emphasis":"hamstring-eccentric"}'::jsonb
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
  'Bridged hamstring curl with the heels on sliders — hamstring work needing no machine.',
  'Lie on your back on a smooth floor, heels on sliders (or a towel, or paper plates), arms flat at your sides.',
  '["Squeeze the glutes and lift the hips into a bridge.","Slide the heels away until the legs are nearly straight, keeping the hips up.","Pull the heels back in under the knees with the hamstrings."]'::jsonb,
  '["Hips stay lifted the whole set — don''t let them sag as the legs slide out.","Slide out only as far as you can keep the hips up; take more range as it gets easier."]'::jsonb,
  '["Dropping the hips to reach further out.","Rushing the slide out — the lengthening half is the work."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'sliding-leg-curl'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  updated_at = excluded.updated_at;
