-- Split the existing Single-Leg RDL into explicit dumbbell and barbell variants.
--
-- The existing `single-leg-rdl` row becomes the dumbbell variant in place. Its
-- slug and UUID do not change, so training maxes, session history and logged
-- sets keep pointing at the same movement without a user-data rewrite. The
-- barbell variant gets a new row so the two implements have independent load
-- histories and equipment filtering.
--
-- Idempotent: both definitions and their instructions are upserted on their
-- existing unique keys, matching the seed runners.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES
  (
    NULL, 'single-leg-rdl', 'Single-Leg Romanian Deadlift (DB)',
    'hinge', 'hamstring_posterior',
    '["lumbar_trunk","knee"]'::jsonb,
    '{hamstrings,glutes}'::muscle[],
    '{abductors,lower_back,lats,forearms,traps}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    NULL, NULL,
    'moderate', 'free', false, false, 2, 4,
    '{"eccentric_cost":"high","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
  ),
  (
    NULL, 'single-leg-rdl-bb', 'Single-Leg Romanian Deadlift (BB)',
    'hinge', 'hamstring_posterior',
    '["lumbar_trunk","knee"]'::jsonb,
    '{hamstrings,glutes}'::muscle[],
    '{abductors,lower_back,lats,forearms,traps}'::muscle[],
    'barbell', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    NULL, NULL,
    'high', 'free', false, false, 2, 4,
    '{"eccentric_cost":"high","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
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
  'Single-leg dumbbell hinge for the hamstrings, glutes and balance.',
  'Hold one or two dumbbells at arm''s length and stand on one leg with a soft knee.',
  '["Hinge at the hip, letting the free leg float back as a counterweight.","Keep the dumbbells close as you lower until the torso and back leg are near parallel.","Squeeze the glute to return upright."]'::jsonb,
  '["Hips stay square to the floor.","Move slowly — control the balance."]'::jsonb,
  '["Letting the hip of the free leg rotate open."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'single-leg-rdl'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  id,
  'Single-leg barbell hinge for the hamstrings, glutes and balance.',
  'Hold a barbell at arm''s length and stand on one leg with a soft knee.',
  '["Hinge at the hip, letting the free leg float back as a counterweight.","Keep the bar close as you lower until the torso and back leg are near parallel.","Squeeze the glute to return upright."]'::jsonb,
  '["Hips stay square to the floor.","Keep the bar close and control the balance."]'::jsonb,
  '["Letting the hip of the free leg rotate open.","Letting the bar drift away from the standing leg."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'single-leg-rdl-bb'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;
