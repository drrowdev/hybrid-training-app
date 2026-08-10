-- Seed the four granular directions of the standing banded four-way hip rehab
-- protocol, plus their in-app how-to content. Idempotent.
-- Hip flexion uses adductor_groin as the closest required existing region and
-- no muscle surrogate; the current taxonomies have no hip-flexor entries.

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
) VALUES
  (
    NULL, 'standing-banded-hip-flexion', 'Standing Banded Hip Flexion',
    'isolation', 'adductor_groin', '[]'::jsonb,
    '{}'::muscle[], '{}'::muscle[], 'band',
    false, 'low', false, '{}'::text[], '{}'::text[], true,
    1, 4, 'low', 'supported', false, false, 0, 4,
    '{"protocol":"banded-four-way-hip","direction":"flexion","emphasis":"hip-flexor-rehab"}'::jsonb
  ),
  (
    NULL, 'standing-banded-hip-extension', 'Standing Banded Hip Extension',
    'isolation', 'hamstring_posterior', '[]'::jsonb,
    '{"glutes"}'::muscle[], '{"hamstrings"}'::muscle[], 'band',
    false, 'low', false, '{}'::text[], '{}'::text[], true,
    1, 4, 'low', 'supported', false, false, 0, 4,
    '{"protocol":"banded-four-way-hip","direction":"extension","emphasis":"hip-extensor-rehab"}'::jsonb
  ),
  (
    NULL, 'standing-banded-hip-abduction', 'Standing Banded Hip Abduction',
    'isolation', 'hamstring_posterior', '[]'::jsonb,
    '{"abductors","glutes"}'::muscle[], '{}'::muscle[], 'band',
    false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], true,
    1, 4, 'low', 'supported', false, false, 0, 4,
    '{"protocol":"banded-four-way-hip","direction":"abduction","emphasis":"lateral-hip-rehab"}'::jsonb
  ),
  (
    NULL, 'standing-banded-hip-adduction', 'Standing Banded Hip Adduction',
    'isolation', 'adductor_groin', '[]'::jsonb,
    '{"adductors"}'::muscle[], '{}'::muscle[], 'band',
    false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], true,
    1, 4, 'low', 'supported', false, false, 0, 4,
    '{"protocol":"banded-four-way-hip","direction":"adduction","emphasis":"adductor-rehab"}'::jsonb
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
  movement.id,
  instruction.summary,
  instruction.setup,
  instruction.steps,
  instruction.cues,
  instruction.common_mistakes,
  'seed-v1',
  true,
  now()
FROM (
  VALUES
    (
      'standing-banded-hip-flexion',
      'Standing band-resisted leg drive forward to train hip flexion as one direction of the four-way hip protocol.',
      'Anchor a band low behind you, loop it around the working ankle, stand tall, and hold a stable support with the opposite hand.',
      '["Brace and shift your weight onto the support leg.","Drive the working leg forward without leaning back.","Pause briefly at the prescribed range.","Return slowly until the band is lightly tensioned."]'::jsonb,
      '["Keep the pelvis level and torso still.","Move from the hip, not the lower back."]'::jsonb,
      '["Leaning backward to create more range.","Letting the band pull the leg back quickly."]'::jsonb
    ),
    (
      'standing-banded-hip-extension',
      'Standing band-resisted leg drive backward to train hip extension as one direction of the four-way hip protocol.',
      'Anchor a band low in front of you, loop it around the working ankle, stand tall, and hold a stable support with the opposite hand.',
      '["Brace and shift your weight onto the support leg.","Drive the working leg straight backward without arching your back.","Pause and squeeze the glute.","Return slowly to the start."]'::jsonb,
      '["Keep the knee mostly straight and pelvis square.","Finish with the glute, not lumbar extension."]'::jsonb,
      '["Arching the lower back instead of extending the hip.","Rotating the pelvis open."]'::jsonb
    ),
    (
      'standing-banded-hip-abduction',
      'Standing band-resisted leg movement outward to train hip abduction as one direction of the four-way hip protocol.',
      'Anchor a band low beside the support leg, loop it around the working ankle, stand tall, and hold a stable support with the opposite hand.',
      '["Brace and keep the support leg softly bent.","Move the working leg out to the side with the toes facing forward.","Pause at the prescribed range.","Return slowly without letting the foot snap inward."]'::jsonb,
      '["Keep the pelvis level.","Lead with the heel and keep the toes forward."]'::jsonb,
      '["Leaning the torso away from the working leg.","Turning the toes outward to gain range."]'::jsonb
    ),
    (
      'standing-banded-hip-adduction',
      'Standing band-resisted leg movement inward to train the adductors as one direction of the four-way hip protocol.',
      'Anchor a band low beside the working leg, loop it around the working ankle, stand tall, and hold a stable support with the opposite hand.',
      '["Brace and shift your weight onto the support leg.","Draw the working leg inward across the body without rotating the pelvis.","Pause at the prescribed range.","Return slowly to the start under band tension."]'::jsonb,
      '["Keep the toes forward and pelvis square.","Use a smooth, controlled range."]'::jsonb,
      '["Twisting the pelvis to pull the leg farther across.","Letting the band pull the leg outward quickly."]'::jsonb
    )
) AS instruction(slug, summary, setup, steps, cues, common_mistakes)
JOIN public.movements movement
  ON movement.user_id IS NULL
 AND movement.slug = instruction.slug
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;
