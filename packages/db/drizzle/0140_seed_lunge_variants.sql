-- Seed the remaining lunge-family variants: walking lunge, step-up,
-- curtsy lunge and lateral lunge.
--
-- Follows 0139, which added forward and reverse lunges. Migration 0019's
-- long-dead slug lists already named `walking-lunge`, `step-up`, `step-up-db`,
-- `step-up-bb` and `curtsy-lunge` — those UPDATEs matched nothing because the
-- rows never existed. The muscle map likewise carried a `walking-lunge` fanout
-- key for an unseeded slug. These rows make those references real.
--
-- Three catalog decisions worth recording:
--
--   * Step-ups keep the `adductors` secondary tag from the seed's squat helper.
--     A step-up is only mildly groin-loading, so dropping the tag would keep it
--     available under an adductor flag — but `affected-movements.ts` matches a
--     limitation on muscle tags, so that would silently overrule a safety gate
--     instead of leaving the user to allow-list it (AGENTS.md: override-and-warn,
--     never silent overrule).
--
--   * The lateral lunge's PRIMARY region is `adductor_groin`, not `knee`. It
--     loads the trailing adductor under a lengthening bias, and a limitation
--     matches on `primary_region` only — `secondary_regions` is never consulted.
--     Mirrors `cossack-squat-loaded`.
--
--   * The box a step-up needs is not modelled. The equipment inventory has no
--     box/bench field, and a `bodyweight-box` tag would additionally read as
--     externally loaded to `carriesExternalLoad`. Equipment is therefore tagged
--     plainly and the box is named in the setup text.
--
-- No barbell curtsy or barbell lateral lunge: the threshold is "commonly
-- programmed under a bar", and neither is.
--
-- `functional_roles` is spelled out because `deriveAccessoryRoles()` runs only
-- while building SEED_MOVEMENTS in TypeScript; a SQL-inserted row without roles
-- would be invisible to the picker's single-leg slot until a full reseed.
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
    NULL, 'walking-lunge', 'Walking Lunge', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"travelling-quad-glute"}'::jsonb
  ),
  (
    NULL, 'walking-lunge-db', 'Walking Lunge (DB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"travelling-quad-glute"}'::jsonb
  ),
  (
    NULL, 'walking-lunge-bb', 'Walking Lunge (BB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'barbell', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'high', 'free', false, false, 2, 4,
    '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"travelling-quad-glute"}'::jsonb
  ),
  (
    NULL, 'step-up', 'Step-Up', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 0, 4,
    '{"eccentric_cost":"low","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"low-impact-single-leg"}'::jsonb
  ),
  (
    NULL, 'step-up-db', 'Step-Up (DB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"low","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"low-impact-single-leg"}'::jsonb
  ),
  (
    NULL, 'step-up-bb', 'Step-Up (BB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors}'::muscle[],
    'barbell', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'high', 'free', false, false, 2, 4,
    '{"eccentric_cost":"low","cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"low-impact-single-leg"}'::jsonb
  ),
  (
    NULL, 'curtsy-lunge', 'Curtsy Lunge', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf","adductor_groin"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors,abductors}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 1, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"frontal-plane-hip"}'::jsonb
  ),
  (
    NULL, 'curtsy-lunge-db', 'Curtsy Lunge (DB)', 'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf","adductor_groin"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors,abductors}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 1, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"frontal-plane-hip"}'::jsonb
  ),
  (
    NULL, 'lateral-lunge', 'Lateral Lunge', 'squat', 'adductor_groin',
    '["knee","hamstring_posterior","lumbar_trunk"]'::jsonb,
    '{quads,adductors,glutes}'::muscle[], '{hamstrings}'::muscle[],
    'bodyweight', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'low', 'free', false, true, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"frontal-plane-groin"}'::jsonb
  ),
  (
    NULL, 'lateral-lunge-db', 'Lateral Lunge (DB)', 'squat', 'adductor_groin',
    '["knee","hamstring_posterior","lumbar_trunk"]'::jsonb,
    '{quads,adductors,glutes}'::muscle[], '{hamstrings}'::muscle[],
    'dumbbells', true, 'low', false,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"frontal-plane-groin"}'::jsonb
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
      'walking-lunge',
      'Lunging forward step after step across the floor — single-leg quads and glutes with a balance demand.',
      'Stand tall at one end of a clear stretch of floor, hands on the hips.',
      '["Step forward and lower until the back knee nears the floor.","Drive through the front foot and bring the back leg through into the next step.","Keep walking for the prescribed reps, counting each leg."]'::jsonb,
      '["Keep the torso tall the whole way down the floor.","Pause if you wobble rather than rushing the next step."]'::jsonb,
      '["Falling forward into each rep instead of stepping under control.","Short steps that push the front knee past the toes."]'::jsonb
    ),
    (
      'walking-lunge-db',
      'Walking lunge holding dumbbells — loaded travelling single-leg work.',
      'A dumbbell in each hand at your sides, facing a clear stretch of floor.',
      '["Step forward and lower until the back knee nears the floor.","Drive through the front foot and bring the back leg through into the next step.","Keep the weights hanging still at your sides as you travel."]'::jsonb,
      '["Chest up, weights quiet.","Same step length every rep."]'::jsonb,
      '["Letting the dumbbells swing and pull you off balance.","Leaning over the front thigh."]'::jsonb
    ),
    (
      'walking-lunge-bb',
      'Walking lunge with a barbell on the back — the heaviest travelling single-leg variation.',
      'Bar on the upper back as for a squat, facing a clear stretch of floor.',
      '["Step forward and lower until the back knee nears the floor.","Drive through the front foot and bring the back leg through into the next step.","Keep the torso tall and the bar level throughout."]'::jsonb,
      '["Brace before every step.","Stop the set while you can still hold position."]'::jsonb,
      '["Travelling further than your balance allows under the bar.","Letting the bar tip as you step through."]'::jsonb
    ),
    (
      'step-up',
      'Stepping up onto a box one leg at a time — single-leg quads and glutes with little joint stress.',
      'Stand facing a box or bench roughly knee height, hands on the hips.',
      '["Place one whole foot on the box.","Drive through that foot to stand up on the box, letting the other leg hang.","Lower back down under control and repeat, then swap legs."]'::jsonb,
      '["Push through the foot on the box, don''t hop off the floor.","Lower slowly rather than dropping."]'::jsonb,
      '["Pushing off the bottom foot to get up.","A box so high the knee caves inward."]'::jsonb
    ),
    (
      'step-up-db',
      'Step-up holding dumbbells — added load for single-leg quads and glutes.',
      'A dumbbell in each hand at your sides, facing a box or bench roughly knee height.',
      '["Place one whole foot on the box.","Drive through that foot to stand up on the box.","Lower back down under control and repeat, then swap legs."]'::jsonb,
      '["All the work through the top foot.","Stand fully upright at the top."]'::jsonb,
      '["Bouncing off the trailing foot.","Letting the weights pull the shoulders forward."]'::jsonb
    ),
    (
      'step-up-bb',
      'Step-up with a barbell on the back — heavy low-impact single-leg strength.',
      'Bar on the upper back as for a squat, facing a box or bench roughly knee height.',
      '["Place one whole foot on the box.","Drive through that foot to stand up on the box.","Lower back down under control and repeat, then swap legs."]'::jsonb,
      '["Brace before each rep.","Keep the front knee tracking over the foot."]'::jsonb,
      '["Using a box too high to control under the bar.","Dropping off the box instead of lowering."]'::jsonb
    ),
    (
      'curtsy-lunge',
      'Stepping the back leg across behind you — single-leg work that loads the side of the hip.',
      'Stand tall, feet hip-width, hands on the hips.',
      '["Step one leg back and across behind the other, like a curtsy.","Lower until the back knee nears the floor, keeping the hips square.","Drive through the front foot to return to standing, then swap legs."]'::jsonb,
      '["Hips stay facing forward as you cross.","Sit into the front hip, not the lower back."]'::jsonb,
      '["Twisting the hips to reach further across.","Letting the front knee collapse inward."]'::jsonb
    ),
    (
      'curtsy-lunge-db',
      'Curtsy lunge holding dumbbells — loaded work for the side of the hip.',
      'A dumbbell in each hand at your sides, feet hip-width.',
      '["Step one leg back and across behind the other, like a curtsy.","Lower until the back knee nears the floor, keeping the hips square.","Drive through the front foot to return to standing, then swap legs."]'::jsonb,
      '["Chest up and hips square throughout.","Control the cross-behind — no swinging."]'::jsonb,
      '["Rotating the pelvis to gain range.","Going heavier than your balance allows."]'::jsonb
    ),
    (
      'lateral-lunge',
      'Stepping wide to one side — single-leg work that loads the groin of the straight leg.',
      'Stand tall, feet together, hands in front of the chest.',
      '["Step wide to one side and sit back into that hip.","Keep the trailing leg straight and both feet flat and pointing forward.","Push back to the middle, then repeat or swap sides."]'::jsonb,
      '["Sit the hips back, don''t just bend the knee.","Ease into the range — the groin should stretch, not pinch."]'::jsonb,
      '["Letting the trailing heel lift.","Dropping into depth faster than the groin can control."]'::jsonb
    ),
    (
      'lateral-lunge-db',
      'Lateral lunge holding a dumbbell — loaded groin and single-leg work in the side-to-side plane.',
      'Hold a dumbbell at the chest, feet together.',
      '["Step wide to one side and sit back into that hip.","Keep the trailing leg straight and both feet flat and pointing forward.","Push back to the middle, then repeat or swap sides."]'::jsonb,
      '["Chest stays up as you sit into the hip.","Add load only once the bodyweight range is comfortable."]'::jsonb,
      '["Rounding forward over the weight.","Chasing depth before the groin tolerates it."]'::jsonb
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
