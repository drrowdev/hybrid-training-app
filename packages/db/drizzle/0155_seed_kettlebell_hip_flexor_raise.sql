-- Add the supported standing kettlebell hip-flexor raise and its how-to.
-- Match banded hip flexion's existing region/taxonomy exception: no false
-- quad/adductor volume and no automatic hip-stabilizer or tendon-protocol role.
-- Shared catalog only; no schema, permissions or user-history changes.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES (
  NULL, 'hip-flexor-raise-kettlebell', 'Hip Flexor Raise (kettlebell)',
  'isolation', 'adductor_groin', '[]'::jsonb,
  '{}'::muscle[], '{}'::muscle[], 'kettlebell', false, 'low',
  false, '{}'::text[], '{}'::text[], true, NULL, NULL,
  'low', 'supported', false, false, 0, 4,
  '{"direction":"flexion","emphasis":"hip-flexor-strength"}'::jsonb
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
  'Standing knee raise with a kettlebell on the foot to strengthen the hip flexors.',
  'Stand beside a stable support with a light kettlebell in front of the working foot. Wear a closed shoe that fits securely through the handle.',
  '["Hold the support and slide the working foot through the handle while the kettlebell rests on the floor.","Pull the toes up to keep the handle secure across the top of the foot.","Raise the knee toward hip height without leaning back or swinging the weight.","Pause, then lower the kettlebell slowly to the floor.","Complete the repetitions, then switch sides."]'::jsonb,
  '["Keep the pelvis level and torso upright.","Keep the toes up; stop if the handle slips or the hip hurts."]'::jsonb,
  '["Swinging the kettlebell or leaning back to lift it higher.","Pointing the toes down and letting the handle slide."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'hip-flexor-raise-kettlebell'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;
