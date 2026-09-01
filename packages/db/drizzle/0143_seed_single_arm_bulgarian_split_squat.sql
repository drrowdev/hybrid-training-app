-- Seed the single-arm dumbbell Bulgarian split squat.
--
-- One dumbbell instead of two. The legs do the same work as
-- `bulgarian-split-squat-db`, but the load is offset, so the lateral trunk
-- holds it isometrically and the balance demand is side-on rather than
-- front-to-back. Separate row so its load history stays separate too.
--
-- Which hand holds the dumbbell IS the difference from the sibling: the
-- instructions specify the hand opposite the front foot. Without that the row
-- would be ambiguous and a lifter could reasonably log either version against
-- it — the objection that made the two Copenhagen rows a duplicate.
--
-- Two attribute decisions worth recording:
--
--   * `obliques` is tagged as a secondary muscle on top of the seed helper's
--     defaults, so an oblique or trunk limitation catches this where it would
--     not catch the symmetrical two-dumbbell version. Same honest-tagging
--     principle as the step-up's adductors in 0140.
--
--   * `functional_roles` is `single_leg` + `compound_assistance` only, NOT
--     `anti_rotation` — even though offset-load trunk bracing is exactly what
--     that role describes. The Hybrid archetype requires `single_leg` and
--     `anti_rotation` weekly and resolves them in that order, deduplicating by
--     movement id only, so a row carrying both roles could be seated as the
--     trunk-stability slot in a session that had already taken a Bulgarian
--     split squat for the leg slot — costing the lifter their trunk work and
--     giving them two split squats. On a suitcase carry the trunk demand is the
--     exercise; here it is incidental to leg work.
--
-- `high_strain_tendon` matches the two-dumbbell sibling: identical knee
-- position and deep-flexion loading, and the flag feeds the tissue/impact
-- stress bucket. Flagging one and not the other would be incoherent.
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
    NULL, 'bulgarian-split-squat-db-single-arm', 'Bulgarian Split Squat (single-arm DB)',
    'squat', 'knee',
    '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
    '{quads,glutes}'::muscle[], '{hamstrings,lower_back,adductors,obliques}'::muscle[],
    'dumbbell-bench', true, 'low', true,
    '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
    NULL, NULL,
    'moderate', 'free', false, false, 0, 4,
    '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"offset-load"}'::jsonb
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
  'Rear-foot-elevated split squat holding one dumbbell — the offset load adds a side-on balance demand.',
  'One dumbbell in the hand opposite the front foot, rear foot up on a bench, front foot forward.',
  '["Lower straight down until the back knee nears the floor.","Keep the shoulders and hips level as the weight pulls to one side.","Drive up through the front foot, then swap the dumbbell over with the legs."]'::jsonb,
  '["Resist the lean toward the weight — stay square.","The free hand can rest on a support if balance is the limit."]'::jsonb,
  '["Letting the loaded side dip and side-bending through the reps.","Twisting toward the dumbbell instead of facing forward."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'bulgarian-split-squat-db-single-arm'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  updated_at = excluded.updated_at;
