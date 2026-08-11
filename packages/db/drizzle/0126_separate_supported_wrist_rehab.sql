-- Keep general forearm strength movements distinct from unilateral,
-- bench-supported rehab variants. Idempotent catalog reconciliation.

UPDATE public.movements
SET
  is_supported = false,
  stability = 'free'
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
) VALUES
  (
    NULL,
    'supported-wrist-curl-db',
    'Supported Wrist Curl (DB)',
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
    '{"emphasis":"wrist-flexion","position":"forearm-supported-supinated"}'::jsonb
  ),
  (
    NULL,
    'supported-reverse-wrist-curl-db',
    'Supported Reverse Wrist Curl (DB)',
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
    '{"emphasis":"wrist-extension","position":"forearm-supported-pronated"}'::jsonb
  ),
  (
    NULL,
    'supported-pronation-supination-db',
    'Supported Pronation / Supination (DB)',
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
    '{"emphasis":"forearm-rotation","position":"forearm-supported-rotation"}'::jsonb
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
      'Standing dumbbell wrist curl for general forearm flexor strength.',
      'Stand with dumbbells at your sides, palms forward and arms still.',
      '["Lower the dumbbells toward the fingers.","Curl up by flexing the wrists.","Lower slowly."]'::jsonb,
      '["Keep the arms at your sides.","Control the full range."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'wrist-curl-bb',
      'Behind-the-back barbell wrist curl for general forearm flexor strength.',
      'Stand holding a barbell behind the thighs with the palms facing back.',
      '["Let the bar roll to the fingers.","Curl it up by flexing the wrists.","Lower slowly."]'::jsonb,
      '["Keep the arms still.","Use a controlled range through the fingers."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'reverse-wrist-curl',
      'Standing palms-down wrist extension for general forearm extensor strength.',
      'Stand holding a light bar or dumbbells in front of the thighs, palms down.',
      '["Raise the back of the hands up toward the forearm.","Pause, then lower slowly."]'::jsonb,
      '["Keep the elbows softly bent and still.","Go light - small muscles."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'db-pronation-supination',
      'Dumbbell pronation and supination for general forearm rotation strength.',
      'Sit or stand with the elbow bent 90 degrees at your side, holding one end of a light dumbbell.',
      '["Rotate the forearm to turn the palm up.","Rotate the forearm the other way to turn it down.","Move slowly through the full range."]'::jsonb,
      '["Keep the elbow pinned at your side.","Slow and controlled."]'::jsonb,
      '[]'::jsonb
    ),
    (
      'supported-wrist-curl-db',
      'Bench-supported palms-up dumbbell wrist flexion for controlled forearm flexor loading.',
      'Rest the forearm palm-up on a bench with the hand just beyond the edge, holding a light dumbbell.',
      '["Keep the forearm and elbow supported.","Lower the dumbbell by extending only the wrist.","Curl the palm toward the forearm without lifting the elbow.","Lower slowly through a comfortable range."]'::jsonb,
      '["Keep the forearm flat on the bench.","Move only at the wrist."]'::jsonb,
      '["Lifting the elbow or forearm to help the curl.","Using finger motion or momentum instead of controlled wrist flexion."]'::jsonb
    ),
    (
      'supported-reverse-wrist-curl-db',
      'Bench-supported palms-down dumbbell wrist extension for controlled forearm extensor loading.',
      'Rest the forearm palm-down on a bench with the hand just beyond the edge, holding a light dumbbell.',
      '["Keep the forearm and elbow supported.","Raise the back of the hand by extending only the wrist.","Pause briefly at the top.","Lower slowly through a comfortable range."]'::jsonb,
      '["Keep the forearm flat on the bench.","Move only at the wrist."]'::jsonb,
      '["Lifting the elbow or forearm off the bench.","Using a weight that forces a shortened or jerky range."]'::jsonb
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
      'supported-pronation-supination-db',
      'Bench-supported pronation and supination with a light dumbbell for controlled forearm rotation.',
      'Rest the full forearm on a bench with the hand just beyond the edge, holding one end of a light dumbbell.',
      '["Keep the elbow and forearm in contact with the bench.","Rotate the forearm slowly until the palm faces up.","Reverse the motion until the palm faces down.","Return through the same controlled range."]'::jsonb,
      '["Rotate the forearm without lifting the elbow.","Use a light load and avoid forcing the end range."]'::jsonb,
      '["Rolling the shoulder or lifting the elbow to move the weight.","Using momentum instead of controlled forearm rotation."]'::jsonb
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
