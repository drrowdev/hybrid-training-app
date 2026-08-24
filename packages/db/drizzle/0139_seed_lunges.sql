-- Seed forward + reverse lunges (bodyweight / DB / BB).
--
-- The catalog had split squats and Bulgarian split squats but no lunge of any
-- kind, while three consumers already assumed one existed:
--   * `apps/web/src/lib/muscle/movement-muscle-map.ts` carried `lunge` and
--     `walking-lunge` fanout keys for slugs that were never seeded;
--   * migration 0019 tagged `forward-lunge` / `reverse-lunge` / `walking-lunge`
--     with the `single_leg` role — all no-op UPDATEs;
--   * `docs/design/accessory-schema.md` lists them as `single_leg` examples.
-- The single-leg pool was thinner than every consumer assumed.
--
-- Attributes mirror the existing `split-squat-db` / `split-squat-bb` pair
-- (pattern `squat`, unilateral, knee region, quads + glutes primary, adductors
-- secondary for the DC groin-limitation filter), with axial load and the
-- experience gate scaling by implement.
--
-- NOTE: `functional_roles` is spelled out here. `deriveAccessoryRoles()` runs
-- only while building SEED_MOVEMENTS in TypeScript (packages/db/seeds/
-- movements.ts) — a SQL migration never executes it, so a row inserted without
-- roles would be invisible to the picker's single-leg slot until someone ran a
-- full reseed. `bulletproof_roles` is empty by derivation: no isometric /
-- HSR / plyo / carry protocol applies.
--
-- Idempotent: upsert on (user_id, slug), matching the seed runner.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES
  (
    NULL, 'forward-lunge', 'Forward Lunge', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"front-knee-loaded"}'::jsonb
  ),
  (
    NULL, 'forward-lunge-db', 'Forward Lunge (DB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"front-knee-loaded"}'::jsonb
  ),
  (
    NULL, 'forward-lunge-bb', 'Forward Lunge (BB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'barbell', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'high', 'free', false, false, 2, 4,
    '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"front-knee-loaded"}'::jsonb
  ),
  (
    NULL, 'reverse-lunge', 'Reverse Lunge', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"hip-loaded-knee-friendly"}'::jsonb
  ),
  (
    NULL, 'reverse-lunge-db', 'Reverse Lunge (DB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"hip-loaded-knee-friendly"}'::jsonb
  ),
  (
    NULL, 'reverse-lunge-bb', 'Reverse Lunge (BB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'barbell', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'high', 'free', false, false, 2, 4,
    '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"hip-loaded-knee-friendly"}'::jsonb
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
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  movement.id,
  instruction.summary,
  instruction.setup,
  instruction.steps,
  instruction.cues,
  instruction.common_mistakes,
  'seed-v1',
  false,
  now()
FROM (
  VALUES
    (
      'forward-lunge',
      'Stepping forward into a lunge and pushing back — single-leg quads and glutes, no equipment.',
      'Stand tall, feet hip-width, hands on the hips.',
      '["Step forward and lower until the back knee nears the floor.","Keep the front shin fairly vertical and the torso tall.","Push off the front foot to return to standing, then swap legs."]'::jsonb,
      '["Step out far enough that the front knee stays over the foot.","Lower straight down, not forward."]'::jsonb,
      '["Short steps that jam the front knee past the toes.","Letting the back knee crash into the floor."]'::jsonb
    ),
    (
      'forward-lunge-db',
      'Forward lunge holding dumbbells — added load for single-leg quads and glutes.',
      'A dumbbell in each hand at your sides, feet hip-width.',
      '["Step forward and lower until the back knee nears the floor.","Keep the chest up and the weights hanging straight down.","Push off the front foot to return to standing, then swap legs."]'::jsonb,
      '["Weights stay at your sides, not swinging.","Most of the work on the front leg."]'::jsonb,
      '["Leaning forward over the front thigh.","Letting the front knee drift inward."]'::jsonb
    ),
    (
      'forward-lunge-bb',
      'Forward lunge with a barbell on the back — the heaviest lunge variation.',
      'Bar on the upper back as for a squat, feet hip-width.',
      '["Step forward and lower until the back knee nears the floor.","Keep the torso tall and the front shin fairly vertical.","Push off the front foot to return to standing, then swap legs."]'::jsonb,
      '["Brace before every step.","Return under control — don''t fall back."]'::jsonb,
      '["Stepping out too far and losing balance under the bar.","Letting the torso pitch forward."]'::jsonb
    ),
    (
      'reverse-lunge',
      'Stepping backward into a lunge — single-leg work that is easier on the front knee.',
      'Stand tall, feet hip-width, hands on the hips.',
      '["Step backward and lower until the back knee nears the floor.","Keep the weight on the front foot and the torso tall.","Drive through the front foot to return to standing, then swap legs."]'::jsonb,
      '["The front foot never moves.","Sit into the front hip as you step back."]'::jsonb,
      '["Pushing off the back foot instead of driving with the front leg.","Twisting the hips as you step."]'::jsonb
    ),
    (
      'reverse-lunge-db',
      'Reverse lunge holding dumbbells — loaded single-leg work with less knee stress than stepping forward.',
      'A dumbbell in each hand at your sides, feet hip-width.',
      '["Step backward and lower until the back knee nears the floor.","Keep the weight on the front foot and the chest up.","Drive through the front foot to return to standing, then swap legs."]'::jsonb,
      '["Front foot planted the whole set.","Control the step back — no thud."]'::jsonb,
      '["Short steps that leave the front knee overloaded.","Rounding forward under the weights."]'::jsonb
    ),
    (
      'reverse-lunge-bb',
      'Reverse lunge with a barbell on the back — heavy single-leg strength.',
      'Bar on the upper back as for a squat, feet hip-width.',
      '["Step backward and lower until the back knee nears the floor.","Keep the torso tall and the weight on the front foot.","Drive through the front foot to return to standing, then swap legs."]'::jsonb,
      '["Brace before every rep.","Find the back foot before lowering."]'::jsonb,
      '["Reaching for the floor with the back foot and losing the brace.","Letting the front knee cave inward on the drive up."]'::jsonb
    )
) AS instruction(slug, summary, setup, steps, cues, common_mistakes)
JOIN public.movements AS movement
  ON movement.user_id IS NULL AND movement.slug = instruction.slug
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  updated_at = excluded.updated_at;
