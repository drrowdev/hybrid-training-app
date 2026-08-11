-- Align the existing forearm drills with their bench-supported instructions and
-- add the missing neutral-grip wrist plane. A hammer curl remains a distinct
-- elbow-flexion movement; this row is wrist radial deviation. Idempotent.

UPDATE public.movements
SET
  is_supported = true,
  stability = 'supported'
WHERE user_id IS NULL
  AND slug IN (
    'wrist-curl-db',
    'wrist-curl-bb',
    'reverse-wrist-curl',
    'db-pronation-supination'
  );

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
  'supported-wrist-radial-deviation-db',
  'Supported Wrist Radial Deviation (DB)',
  'isolation',
  'elbow_forearm',
  '[]'::jsonb,
  '{"forearms"}'::muscle[],
  '{}'::muscle[],
  'dumbbell',
  false,
  'low',
  false,
  '{}'::text[],
  '{}'::text[],
  true,
  NULL,
  NULL,
  'low',
  'supported',
  false,
  false,
  0,
  4,
  '{"emphasis":"wrist-radial-deviation","position":"forearm-supported-neutral"}'::jsonb
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
      'wrist-curl-db',
      'Bench-supported palms-up dumbbell wrist flexion for the forearm flexors.',
      'Rest the forearms on a bench, palms up, holding dumbbells.',
      '["Lower the dumbbells toward the fingers.","Curl up by flexing the wrists.","Lower slowly."]'::jsonb,
      '["Keep the forearms still.","Control the full range."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'wrist-curl-bb',
      'Bench-supported palms-up barbell wrist flexion for the forearm flexors.',
      'Rest the forearms on a bench, palms up, holding a barbell.',
      '["Let the bar roll to the fingers.","Curl it up by flexing the wrists.","Lower slowly."]'::jsonb,
      '["Forearms stay flat on the bench.","Full range through the fingers."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'reverse-wrist-curl',
      'Bench-supported palms-down wrist extension to train the forearm extensors.',
      'Rest the forearms on a bench, palms down, holding a light bar or dumbbells.',
      '["Raise the back of the hands up toward the forearm.","Pause, then lower slowly."]'::jsonb,
      '["Keep the forearms flat on the bench.","Go light - small muscles."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'supported-wrist-radial-deviation-db',
      'Bench-supported neutral-grip wrist radial deviation for the forearm.',
      'Rest the forearm on its side on a bench with the thumb up and the hand just beyond the edge, holding a light dumbbell.',
      '["Keep the forearm and elbow supported.","Raise the thumb side of the hand toward the forearm without rotating the palm.","Pause briefly at the top.","Lower slowly through a comfortable range."]'::jsonb,
      '["Lead with the thumb; keep the forearm from rolling.","Move at the wrist, not the elbow."]'::jsonb,
      '["Turning the palm up or down instead of moving at the wrist.","Lifting the elbow or using a weight that shortens the range."]'::jsonb
    ),
    (
      'db-pronation-supination',
      'Bench-supported pronation and supination with a light dumbbell to train forearm rotation.',
      'Sit with the forearm on a bench, holding one end of a light dumbbell.',
      '["Rotate the wrist to turn the palm up.","Rotate the other way to turn it down.","Move slowly through the full range."]'::jsonb,
      '["Keep the forearm still on the bench.","Slow and controlled."]'::jsonb,
      '[]'::jsonb
    )
) AS instruction(
  slug,
  summary,
  setup,
  steps,
  cues,
  common_mistakes
)
JOIN public.movements AS movement
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
