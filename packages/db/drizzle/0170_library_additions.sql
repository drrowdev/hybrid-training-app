-- Library additions: push-up and press variants, pulls, arm and delt work, leg and
-- hip work, full-body and Olympic lifts, core, neck, carries, and extra cardio
-- modalities (115 shared movements with how-to text).
-- Shared catalog only (user_id IS NULL). Existing rows are never overwritten.
-- Also reclassifies the existing push-up as a press so its variations swap with it.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-incline', 'Incline Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  true, 0, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high","emphasis":"lower-chest-angle-regression"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-decline', 'Decline Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{upper_chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-neutral-grip', 'Neutral-Grip Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs,side_delts}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 0, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high","emphasis":"wrist-and-shoulder-friendly"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-deficit', 'Deficit Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high","rom_profile":"stretched"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-neutral-grip-deficit', 'Deficit Neutral-Grip Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs,side_delts}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high","rom_profile":"stretched","emphasis":"wrist-and-shoulder-friendly"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-diamond', 'Diamond Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{triceps,chest,front_delts}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-archer', 'Archer Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  true, 2, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-hand-release', 'Hand-Release Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 0, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high","emphasis":"dead-stop-reps"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-weighted', 'Weighted Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight-or-loaded', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-ring', 'Ring Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'rings', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 2, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-pike', 'Pike Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{front_delts,triceps,upper_chest}'::public.muscle[], '{side_delts,traps}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'handstand-push-up', 'Handstand Push-Up', 'press',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{front_delts,triceps,upper_chest}'::public.muscle[], '{side_delts,traps,abs}'::public.muscle[], 'bodyweight-wall', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  true, 3, 4, '{"cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-clap', 'Clap Push-Up', 'plyometric',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{abs}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{power_plyometric}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 2, 4, '{"cns_cost":"moderate","emphasis":"upper-body-rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'scapular-push-up', 'Scapular Push-Up', 'cuff',
  'shoulder_scapular', '[]'::jsonb,
  '{mid_back,traps}'::public.muscle[], '{chest,front_delts}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{shoulder_stability}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"scap-control"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'push-up-plus', 'Push-Up Plus', 'cuff',
  'shoulder_scapular', '[]'::jsonb,
  '{mid_back,chest}'::public.muscle[], '{front_delts,triceps}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{shoulder_stability}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"scap-control"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'wall-slide', 'Wall Slide', 'cuff',
  'shoulder_scapular', '[]'::jsonb,
  '{mid_back,traps}'::public.muscle[], '{rear_delts}'::public.muscle[], 'bodyweight-wall', false, 'low',
  false, '{}'::text[], '{shoulder_stability}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"scap-control"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'machine-shoulder-press', 'Machine Shoulder Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{front_delts,side_delts,triceps}'::public.muscle[], '{upper_chest}'::public.muscle[], 'machine-shoulder-press', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'db-bench-neutral', 'Neutral-Grip DB Bench Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'dumbbells-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'db-bench-incline-neutral', 'Neutral-Grip Incline DB Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{upper_chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'dumbbells-incline-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'db-bench-single-arm', 'Single-Arm DB Bench Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts,obliques}'::public.muscle[], 'dumbbell-bench', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 1, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'db-floor-press', 'DB Floor Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,triceps,front_delts}'::public.muscle[], '{side_delts}'::public.muscle[], 'dumbbells', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate","rom_profile":"partial"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-chest-press-standing', 'Standing Cable Chest Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts,abs}'::public.muscle[], 'cable', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-chest-press-seated', 'Seated Cable Chest Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'cable-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'machine-chest-press-incline', 'Incline Machine Chest Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{upper_chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'machine-chest-press-incline', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-press', 'Kettlebell Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{front_delts,side_delts,triceps}'::public.muscle[], '{upper_chest,obliques}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'free', false,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-press-bottoms-up', 'Bottoms-Up Kettlebell Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{front_delts,triceps,forearms}'::public.muscle[], '{side_delts,obliques}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 2, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high","emphasis":"shoulder-stability"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'spoto-press', 'Spoto Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'barbell-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"cns_cost":"high","stim_fatigue_ratio":"moderate","tempo":"1-1-X-0","emphasis":"pause-above-chest"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pin-press-bench', 'Bench Pin Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'barbell-bench-pins', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"dead-stop-from-pins","rom_profile":"partial"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'board-press', 'Board Press', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{chest,front_delts,triceps}'::public.muscle[], '{side_delts}'::public.muscle[], 'barbell-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"lockout-strength","rom_profile":"partial"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pull-up-wide', 'Wide-Grip Pull-Up', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'bar', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 1, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pull-up-ring', 'Ring Pull-Up', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back,biceps}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'rings', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 2, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pull-up-assisted-machine', 'Assisted Pull-Up (machine)', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back,biceps}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'machine-assisted', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pull-up-band-assisted', 'Band-Assisted Pull-Up', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back,biceps}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'bar', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'lat-pulldown-wide-overhand', 'Lat Pulldown (wide overhand)', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'cable-pulldown', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'lat-pulldown-underhand', 'Lat Pulldown (underhand)', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,biceps}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 'cable-pulldown', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'machine-high-row', 'Machine High Row', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back}'::public.muscle[], '{biceps,rear_delts}'::public.muscle[], 'machine-high-row', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-row-single-arm', 'Single-Arm Cable Row', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{lats,mid_back,biceps}'::public.muscle[], '{rear_delts,forearms,obliques}'::public.muscle[], 'cable', true, 'low',
  false, '{}'::text[], '{anti_rotation,compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-row-rope', 'Cable Row (rope)', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{mid_back,rear_delts,lats}'::public.muscle[], '{biceps}'::public.muscle[], 'cable-rope', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'smith-row', 'Smith Machine Row', 'pull',
  'shoulder_scapular', '["elbow_forearm","lumbar_trunk"]'::jsonb,
  '{lats,mid_back,biceps}'::public.muscle[], '{rear_delts,forearms,lower_back}'::public.muscle[], 'smith', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 't-bar-row-chest-supported', 'Chest-Supported T-Bar Row', 'pull',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{mid_back,lats}'::public.muscle[], '{rear_delts,forearms}'::public.muscle[], 't-bar-chest-supported', true, 'low',
  false, '{}'::text[], '{compound_assistance,pull}'::text[], true,
  NULL, NULL, 'low', 'supported', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'towel-hang', 'Towel Hang', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{forearms}'::public.muscle[], '{lats}'::public.muscle[], 'bar', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"grip-endurance","protocol":"hold-timed"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'fat-grip-dead-hang', 'Fat-Grip Dead Hang', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{forearms}'::public.muscle[], '{lats}'::public.muscle[], 'bar', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"grip-endurance","protocol":"hold-timed"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'reverse-curl-ez', 'Reverse Curl (EZ)', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{forearms,biceps}'::public.muscle[], '{}'::public.muscle[], 'ez-bar', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'hammer-curl-cross-body', 'Cross-Body Hammer Curl', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{biceps,forearms}'::public.muscle[], '{}'::public.muscle[], 'dumbbells', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'zottman-curl', 'Zottman Curl', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{biceps,forearms}'::public.muscle[], '{}'::public.muscle[], 'dumbbells', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-curl-bayesian', 'Bayesian Cable Curl', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{biceps}'::public.muscle[], '{forearms}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high","rom_profile":"stretched"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-curl-bar', 'Cable Curl (straight bar)', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{biceps}'::public.muscle[], '{forearms}'::public.muscle[], 'cable-bar', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'preacher-curl-machine', 'Preacher Curl (machine)', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{biceps}'::public.muscle[], '{forearms}'::public.muscle[], 'machine-preacher-curl', false, 'low',
  false, '{}'::text[], '{}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'pushdown-single-arm', 'Single-Arm Cable Pushdown', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{triceps}'::public.muscle[], '{}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'tri-ext-cross-body-db', 'Cross-Body Triceps Extension (DB)', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{triceps}'::public.muscle[], '{}'::public.muscle[], 'dumbbell', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'dip-machine', 'Machine Dip', 'press',
  'shoulder_scapular', '["elbow_forearm"]'::jsonb,
  '{triceps,chest,front_delts}'::public.muscle[], '{}'::public.muscle[], 'machine-dip', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'lateral-raise-bent-over-db', 'Bent-Over Lateral Raise (DB)', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{rear_delts}'::public.muscle[], '{mid_back,traps}'::public.muscle[], 'dumbbells', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-rear-delt-fly', 'Cable Rear Delt Fly', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{rear_delts}'::public.muscle[], '{mid_back}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'lateral-raise-cable-behind-back', 'Behind-the-Back Cable Lateral Raise', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{side_delts}'::public.muscle[], '{traps}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-y-raise', 'Cable Y-Raise', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{side_delts,rear_delts,traps}'::public.muscle[], '{mid_back}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'leg-press-single-leg', 'Single-Leg Leg Press', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,lower_back,adductors}'::public.muscle[], 'machine-leg-press', true, 'low',
  false, '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
  NULL, NULL, 'low', 'fixed_path', false,
  false, 0, 4, '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'hack-squat-reverse', 'Reverse Hack Squat', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
  '{glutes,quads}'::public.muscle[], '{hamstrings,lower_back,adductors}'::public.muscle[], 'machine-hack-reverse', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'fixed_path', true,
  false, 0, 4, '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'heel-elevated-goblet-squat', 'Heel-Elevated Goblet Squat', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,lower_back,adductors}'::public.muscle[], 'dumbbell-or-kb', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'supported', true,
  false, 0, 4, '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"high","emphasis":"quad-biased-upright"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'step-up-lateral', 'Lateral Step-Up', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
  '{quads,glutes,abductors}'::public.muscle[], '{adductors,hamstrings}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  true, 0, 4, '{"eccentric_cost":"low","cns_cost":"low","stim_fatigue_ratio":"moderate","emphasis":"frontal-plane-single-leg"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'shrimp-squat', 'Shrimp Squat', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,lower_back,adductors}'::public.muscle[], 'bodyweight', true, 'low',
  false, '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 3, 4, '{"eccentric_cost":"high","cns_cost":"moderate","stim_fatigue_ratio":"moderate","rom_profile":"deep"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'thruster-bb', 'Barbell Thruster', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{front_delts,triceps,abs,lower_back}'::public.muscle[], 'barbell', true, 'moderate',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 2, 4, '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"low","emphasis":"squat-to-press"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'thruster-db', 'DB Thruster', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{front_delts,triceps,abs,lower_back}'::public.muscle[], 'dumbbells', true, 'moderate',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 1, 4, '{"eccentric_cost":"moderate","cns_cost":"moderate","stim_fatigue_ratio":"low","emphasis":"squat-to-press"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'overhead-squat', 'Overhead Squat', 'squat',
  'knee', '["hamstring_posterior","lumbar_trunk","foot_ankle_calf","shoulder_scapular"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,lower_back,adductors,traps,front_delts,abs}'::public.muscle[], 'barbell', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 3, 4, '{"eccentric_cost":"moderate","cns_cost":"high","stim_fatigue_ratio":"moderate","emphasis":"mobility-and-stability"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-deadlift', 'Kettlebell Deadlift', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{hamstrings,glutes}'::public.muscle[], '{lower_back,forearms,quads}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 0, 4, '{"eccentric_cost":"low","cns_cost":"low","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'rdl-trap-bar', 'Trap Bar Romanian Deadlift', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{hamstrings,glutes}'::public.muscle[], '{lower_back,lats,forearms,traps}'::public.muscle[], 'trap-bar', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 0, 4, '{"eccentric_cost":"high","cns_cost":"moderate","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'hip-thrust-machine', 'Machine Hip Thrust', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{glutes}'::public.muscle[], '{hamstrings}'::public.muscle[], 'machine-hip-thrust', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], true,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"eccentric_cost":"high","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'hip-thrust-db', 'DB Hip Thrust', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{glutes}'::public.muscle[], '{hamstrings}'::public.muscle[], 'dumbbells-bench', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  false, 0, 4, '{"eccentric_cost":"high","cns_cost":"high","stim_fatigue_ratio":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'glute-ham-raise', 'Glute-Ham Raise', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{hamstrings,glutes}'::public.muscle[], '{lower_back,calves}'::public.muscle[], 'machine-glute-ham', true, 'low',
  true, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'low', 'supported', true,
  false, 2, 4, '{"eccentric_cost":"high","cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'snatch-grip-deadlift', 'Snatch-Grip Deadlift', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{hamstrings,glutes,lower_back,traps}'::public.muscle[], '{lats,forearms,traps}'::public.muscle[], 'barbell', true, 'low',
  false, '{}'::text[], '{compound_assistance}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 2, 4, '{"eccentric_cost":"high","cns_cost":"high","stim_fatigue_ratio":"moderate","rom_profile":"extended"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'calf-raise-leg-press', 'Leg Press Calf Raise', 'isolation',
  'foot_ankle_calf', '[]'::jsonb,
  '{calves}'::public.muscle[], '{}'::public.muscle[], 'machine-leg-press', false, 'low',
  false, '{}'::text[], '{ankle_foot}'::text[], false,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'calf-raise-smith', 'Smith Machine Calf Raise', 'isolation',
  'foot_ankle_calf', '[]'::jsonb,
  '{calves}'::public.muscle[], '{}'::public.muscle[], 'smith', false, 'low',
  false, '{}'::text[], '{ankle_foot}'::text[], false,
  NULL, NULL, 'low', 'fixed_path', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'calf-raise-donkey', 'Donkey Calf Raise', 'isolation',
  'foot_ankle_calf', '[]'::jsonb,
  '{calves}'::public.muscle[], '{}'::public.muscle[], 'bodyweight-or-loaded', false, 'low',
  false, '{}'::text[], '{ankle_foot}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high","rom_profile":"stretched"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'peroneal-raise-band', 'Peroneal Raise (band eversion)', 'isolation',
  'foot_ankle_calf', '[]'::jsonb,
  '{calves}'::public.muscle[], '{tibialis}'::public.muscle[], 'band', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"emphasis":"ankle-stability"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-hip-adduction', 'Cable Hip Adduction', 'isolation',
  'adductor_groin', '[]'::jsonb,
  '{adductors}'::public.muscle[], '{}'::public.muscle[], 'cable-ankle', false, 'low',
  false, '{}'::text[], '{hip_stabilizer}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'terminal-knee-extension-band', 'Banded Terminal Knee Extension', 'isolation',
  'knee', '[]'::jsonb,
  '{quads}'::public.muscle[], '{}'::public.muscle[], 'band', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"knee-rehab-strength","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'adductor-squeeze-ball', 'Adductor Ball Squeeze', 'isolation',
  'adductor_groin', '[]'::jsonb,
  '{adductors}'::public.muscle[], '{}'::public.muscle[], 'ball', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"protocol":"static-hold","emphasis":"groin-prehab"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'bridge-walkout', 'Hamstring Bridge Walk-Out', 'isolation',
  'hamstring_posterior', '[]'::jsonb,
  '{hamstrings,glutes}'::public.muscle[], '{}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 1, 4, '{"stim_fatigue_ratio":"high","emphasis":"machine-free-hamstring"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'clean', 'Clean', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,quads,traps}'::public.muscle[], '{lower_back,front_delts,calves,forearms}'::public.muscle[], 'barbell', true, 'low',
  true, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 3, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'snatch', 'Snatch', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,quads,traps}'::public.muscle[], '{lower_back,front_delts,calves,forearms}'::public.muscle[], 'barbell', true, 'low',
  true, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 3, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'clean-and-jerk', 'Clean & Jerk', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,quads,front_delts}'::public.muscle[], '{traps,triceps,lower_back,calves,forearms}'::public.muscle[], 'barbell', true, 'low',
  true, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 3, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'clean-and-press', 'Clean and Press', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,front_delts,traps}'::public.muscle[], '{quads,triceps,lower_back,forearms}'::public.muscle[], 'barbell', true, 'low',
  true, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'high', 'free', true,
  false, 3, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'db-hang-clean', 'DB Hang Clean', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,quads,traps}'::public.muscle[], '{lower_back,front_delts,calves,forearms}'::public.muscle[], 'dumbbells', true, 'low',
  false, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 2, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-clean', 'Kettlebell Clean', 'olympic',
  'hamstring_posterior', '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
  '{hamstrings,glutes,quads,traps}'::public.muscle[], '{lower_back,front_delts,calves,forearms}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{power_olympic}'::text[], false,
  NULL, NULL, 'moderate', 'free', false,
  false, 1, 4, '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-swing-single-arm', 'Single-Arm KB Swing', 'hinge',
  'hamstring_posterior', '["lumbar_trunk","knee"]'::jsonb,
  '{glutes,hamstrings}'::public.muscle[], '{lower_back,forearms,abs,obliques}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{compound_assistance,single_leg}'::text[], false,
  NULL, NULL, 'moderate', 'free', false,
  false, 1, 4, '{"eccentric_cost":"low","cns_cost":"moderate","stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'turkish-get-up', 'Turkish Get-Up', 'isolation',
  'shoulder_scapular', '["lumbar_trunk","knee"]'::jsonb,
  '{front_delts,abs,glutes}'::public.muscle[], '{obliques,quads,traps}'::public.muscle[], 'kettlebell', true, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'moderate', 'free', false,
  false, 1, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"moderate","emphasis":"full-body-stability"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'kb-windmill', 'Kettlebell Windmill', 'isolation',
  'lumbar_trunk', '["shoulder_scapular","hamstring_posterior"]'::jsonb,
  '{obliques,abs}'::public.muscle[], '{glutes,hamstrings,front_delts}'::public.muscle[], 'kettlebell', false, 'low',
  false, '{}'::text[], '{loaded_mobility}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 2, 4, '{"stim_fatigue_ratio":"moderate","emphasis":"loaded-mobility"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'carry-sandbag', 'Sandbag Carry', 'carry',
  'lumbar_trunk', '["elbow_forearm","shoulder_scapular"]'::jsonb,
  '{abs,obliques,traps,forearms}'::public.muscle[], '{lower_back,glutes,biceps}'::public.muscle[], 'sandbag', true, 'low',
  false, '{carry}'::text[], '{}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high","emphasis":"isometric-stabilisation"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'carry-bear-hug-sandbag', 'Bear-Hug Sandbag Carry', 'carry',
  'lumbar_trunk', '["elbow_forearm","shoulder_scapular"]'::jsonb,
  '{abs,obliques,biceps,forearms}'::public.muscle[], '{lower_back,glutes,traps}'::public.muscle[], 'sandbag', true, 'low',
  false, '{carry}'::text[], '{}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 0, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high","emphasis":"isometric-stabilisation"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'carry-front-rack', 'Front-Rack Carry', 'carry',
  'lumbar_trunk', '["elbow_forearm","shoulder_scapular"]'::jsonb,
  '{abs,obliques,upper_chest,forearms}'::public.muscle[], '{lower_back,glutes,traps,front_delts}'::public.muscle[], 'dumbbell-or-kb', true, 'low',
  false, '{carry}'::text[], '{}'::text[], false,
  NULL, NULL, 'moderate', 'free', true,
  false, 1, 4, '{"cns_cost":"moderate","stim_fatigue_ratio":"high","emphasis":"isometric-stabilisation"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'crunch-floor', 'Crunch', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'sit-up', 'Sit-Up', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'v-up', 'V-Up', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques,quads}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 1, 4, '{}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'russian-twist', 'Russian Twist', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{obliques,abs}'::public.muscle[], '{}'::public.muscle[], 'bodyweight-or-loaded', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"rotational-trunk"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'cable-woodchop', 'Cable Woodchop', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{obliques,abs}'::public.muscle[], '{front_delts,glutes}'::public.muscle[], 'cable', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{"emphasis":"rotational-power"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'landmine-rotation', 'Landmine Rotation', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{obliques,abs}'::public.muscle[], '{front_delts,glutes}'::public.muscle[], 'landmine', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 1, 4, '{"emphasis":"rotational-power"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'l-sit', 'L-Sit', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{quads,triceps,front_delts}'::public.muscle[], 'parallettes-or-floor', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"protocol":"static-hold","emphasis":"compression-strength"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'mountain-climber', 'Mountain Climber', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques,front_delts,quads}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"trunk-conditioning"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'bear-crawl', 'Bear Crawl', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs,front_delts}'::public.muscle[], '{obliques,quads,triceps}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"trunk-conditioning"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'lying-leg-raise', 'Lying Leg Raise', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques,quads}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"emphasis":"lower-abs"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'side-bend-db', 'Weighted Side Bend (DB)', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{obliques}'::public.muscle[], '{abs,forearms}'::public.muscle[], 'dumbbell', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', false,
  false, 0, 4, '{}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'windshield-wiper-hanging', 'Hanging Windshield Wiper', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{obliques,abs}'::public.muscle[], '{lats,forearms}'::public.muscle[], 'bar', false, 'low',
  false, '{}'::text[], '{anti_rotation}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 3, 4, '{"protocol":"anti-rotation","emphasis":"rotational-control"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'mcgill-curl-up', 'McGill Curl-Up', 'isolation',
  'lumbar_trunk', '[]'::jsonb,
  '{abs}'::public.muscle[], '{obliques}'::public.muscle[], 'bodyweight', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"protocol":"static-hold","emphasis":"spine-sparing-flexion"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'neck-flexion', 'Neck Flexion', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{neck}'::public.muscle[], '{}'::public.muscle[], 'bodyweight-or-loaded', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"moderate","emphasis":"neck-strength"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'neck-extension', 'Neck Extension', 'isolation',
  'shoulder_scapular', '[]'::jsonb,
  '{neck,traps}'::public.muscle[], '{}'::public.muscle[], 'bodyweight-or-loaded', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"moderate","emphasis":"neck-strength"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'assault-bike-intervals', 'Assault Bike — Intervals', 'cardio',
  'knee', '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,calves}'::public.muscle[], 'air-bike', false, 'moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"air-bike","protocol":"intervals-20s-40s","impact":"none"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'assault-bike-z2', 'Assault Bike — Z2', 'cardio',
  'knee', '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,calves}'::public.muscle[], 'air-bike', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"air-bike","zone":"Z2","impact":"none"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'walk-incline-treadmill', 'Incline Treadmill Walk', 'cardio',
  'foot_ankle_calf', '["knee","hamstring_posterior"]'::jsonb,
  '{calves,glutes,quads}'::public.muscle[], '{hamstrings}'::public.muscle[], 'treadmill', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"walking","zone":"Z2","impact":"low"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'walk-easy', 'Easy Walk', 'cardio',
  'foot_ankle_calf', '["knee","hamstring_posterior"]'::jsonb,
  '{calves,quads,glutes}'::public.muscle[], '{hamstrings}'::public.muscle[], 'shoes', false, 'very_low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"walking","zone":"Z1","impact":"low"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'hike', 'Hike', 'cardio',
  'foot_ankle_calf', '["knee","hamstring_posterior"]'::jsonb,
  '{calves,quads,glutes}'::public.muscle[], '{hamstrings}'::public.muscle[], 'shoes-outdoor', false, 'low',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"walking","zone":"Z2","impact":"low","terrain":"trail"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'run-z2-trail', 'Trail Run — Z2', 'cardio',
  'foot_ankle_calf', '["knee","hamstring_posterior"]'::jsonb,
  '{calves,quads,hamstrings,glutes}'::public.muscle[], '{tibialis}'::public.muscle[], 'shoes-trail', false, 'moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 1, 4, '{"modality":"running","zone":"Z2","terrain":"trail","impact":"moderate"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'run-vo2-treadmill-intervals', 'Treadmill — VO2 Intervals', 'cardio',
  'foot_ankle_calf', '["knee","hamstring_posterior"]'::jsonb,
  '{calves,quads,hamstrings,glutes}'::public.muscle[], '{tibialis}'::public.muscle[], 'treadmill', false, 'high',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"modality":"running","zone":"Z5","protocol":"vo2-4x4","impact":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'bike-sweet-spot', 'Bike — Sweet Spot', 'cardio',
  'knee', '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
  '{quads,glutes}'::public.muscle[], '{hamstrings,calves}'::public.muscle[], 'stationary-bike', false, 'low_moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 1, 4, '{"modality":"cycling","zone":"Z3","protocol":"2x20min-sweet-spot","impact":"very_low"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'ski-erg-intervals', 'Ski Erg — Intervals', 'cardio',
  'lumbar_trunk', '["shoulder_scapular"]'::jsonb,
  '{lats,abs,triceps}'::public.muscle[], '{chest,mid_back}'::public.muscle[], 'ski-erg', false, 'moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 2, 4, '{"modality":"ski-erg","zone":"Z5","protocol":"vo2-4x4","impact":"none"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'battle-ropes', 'Battle Ropes', 'cardio',
  'shoulder_scapular', '["lumbar_trunk"]'::jsonb,
  '{front_delts,side_delts,abs}'::public.muscle[], '{lats,forearms,quads}'::public.muscle[], 'battle-ropes', false, 'low_moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"kind":"cardio_other","modality":"conditioning","protocol":"intervals-20s-40s","impact":"none"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'burpee', 'Burpee', 'cardio',
  'knee', '["foot_ankle_calf","shoulder_scapular","lumbar_trunk"]'::jsonb,
  '{quads,chest,front_delts}'::public.muscle[], '{triceps,abs,glutes,calves}'::public.muscle[], 'bodyweight', true, 'moderate',
  false, '{}'::text[], '{}'::text[], false,
  NULL, NULL, 'low', 'free', true,
  true, 0, 4, '{"kind":"cardio_other","modality":"calisthenics","impact":"high","emphasis":"full-body-conditioning"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with hands raised on a bench or box, an easier angle that still loads the chest and triceps.', 'Hands on a stable raised surface, shoulder-width, body in one straight line from head to heels.',
  '["Brace your abs and glutes.","Lower your chest to the edge of the surface.","Press back up until your elbows lock out."]'::jsonb,
  '["Body stays in one line.","Elbows about 45° from your ribs."]'::jsonb,
  '["Letting the hips sag toward the surface."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-incline'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with feet raised, shifting load toward the upper chest and shoulders.', 'Feet on a bench or box, hands on the floor just wider than your shoulders.',
  '["Brace your abs and glutes.","Lower your chest to just above the floor.","Press back up to full lockout."]'::jsonb,
  '["Keep your ribs down.","Elbows about 45° from your ribs."]'::jsonb,
  '["Piking at the hips as the feet rise."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-decline'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with palms facing each other, which keeps the wrists and shoulders in a friendlier position.', 'Hold parallettes, dumbbell handles or push-up handles under your shoulders, palms facing in.',
  '["Brace your abs and glutes.","Lower your chest between the handles.","Press back up to full lockout."]'::jsonb,
  '["Elbows track back, close to your ribs.","Wrists stay straight."]'::jsonb,
  '["Flaring the elbows out to the sides."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-neutral-grip'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with hands raised so the chest sinks below hand level, adding range at the bottom.', 'Place a hand on each of two plates, books or blocks, shoulder-width apart, body in a straight line.',
  '["Brace your abs and glutes.","Lower until your chest drops below your hands.","Press back up to lockout."]'::jsonb,
  '["Control the bottom; don''t drop into it.","Shoulder blades stay set."]'::jsonb,
  '["Sagging the hips or shrugging at the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-deficit'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Neutral-grip push-up from raised handles so the chest travels below hand level.', 'Hold two parallettes or dumbbell handles on raised supports, palms facing in, body in a straight line.',
  '["Brace your abs and glutes.","Lower until your chest passes below the handles.","Press back up to lockout."]'::jsonb,
  '["Elbows close to your ribs.","Control the stretch at the bottom."]'::jsonb,
  '["Dropping into the bottom so the shoulders roll forward."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-neutral-grip-deficit'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with hands close together, shifting more work to the triceps.', 'Hands under your chest with thumbs and index fingers close together, body in a straight line.',
  '["Brace your abs and glutes.","Lower your chest toward your hands, elbows tracking back.","Press back up to lockout."]'::jsonb,
  '["Keep elbows close to your ribs.","Wrists stay comfortable; widen the hands slightly if they don''t."]'::jsonb,
  '["Letting the elbows flare wide."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-diamond'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up where one arm does most of the work while the other slides out straight.', 'Start in a wide push-up position, hands well outside your shoulders.',
  '["Shift your weight over one hand and bend that elbow.","Keep the other arm straight as you lower.","Press back to the middle and repeat on the other side."]'::jsonb,
  '["Hips stay square to the floor.","Straight arm only guides; the working arm lifts you."]'::jsonb,
  '["Rotating the torso instead of shifting sideways."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-archer'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with a full stop on the floor and the hands lifted off each rep, removing the bounce.', 'Standard push-up position, body in a straight line.',
  '["Lower until your chest rests on the floor.","Lift your hands off the floor for a moment.","Place them back and press up to lockout."]'::jsonb,
  '["Chest touches the floor each rep.","Hips and chest rise together."]'::jsonb,
  '["Sagging the hips while the hands are off the floor."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-hand-release'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up with added load on the back to keep it hard once bodyweight reps get easy.', 'Get into a push-up position and have a plate or weighted vest placed across your upper back.',
  '["Brace your abs and glutes.","Lower your chest to just above the floor.","Press back up to lockout."]'::jsonb,
  '["Keep your body in one line under load.","Shoulder blades stay set."]'::jsonb,
  '["Letting the lower back sag under the weight."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-weighted'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up on rings, which demands extra shoulder and trunk stability.', 'Set rings low, hold them under your shoulders and get into a plank, body in a straight line.',
  '["Brace your abs and glutes.","Lower your chest between the rings.","Press up and turn your palms slightly forward at the top."]'::jsonb,
  '["Keep the rings close to your ribs.","Hold the rings steady throughout."]'::jsonb,
  '["Letting the rings drift apart as you lower."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-ring'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up from a hips-high position that trains the shoulders and triceps.', 'Hands on the floor, hips raised so your body forms an inverted V, feet close together.',
  '["Bend your elbows to lower your head toward the floor between your hands.","Press back up to straight arms.","Keep your hips high throughout."]'::jsonb,
  '["Hips stay high.","Head travels forward of your hands."]'::jsonb,
  '["Turning it into a regular push-up by dropping the hips."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-pike'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Vertical press in a handstand against a wall for the shoulders and triceps.', 'Kick up to a handstand facing the wall, hands shoulder-width apart, body tight.',
  '["Brace your abs and glutes.","Lower your head toward the floor under control.","Press back up to full lockout."]'::jsonb,
  '["Ribs down, body tight.","Elbows slightly forward, not flared."]'::jsonb,
  '["Arching the lower back to cheat the press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'handstand-push-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Explosive push-up that leaves the floor so the hands can clap.', 'Start in a push-up position on a firm floor.',
  '["Lower your chest to just above the floor.","Push up explosively so your hands leave the floor.","Clap and land with soft, slightly bent elbows."]'::jsonb,
  '["Land softly.","Reset before each rep."]'::jsonb,
  '["Landing with locked elbows."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-clap'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Small push-up motion that moves only the shoulder blades to build scapular control.', 'Start in a straight-arm plank, hands under your shoulders.',
  '["Keeping your elbows straight, let your chest sink between your shoulder blades.","Push the floor away to spread your shoulder blades apart.","Repeat with a smooth tempo."]'::jsonb,
  '["Arms stay straight.","Move only at the shoulder blades."]'::jsonb,
  '["Bending the elbows."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'scapular-push-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Push-up finished with an extra reach that trains the muscle that holds the shoulder blade to the ribs.', 'Standard push-up position, body in a straight line.',
  '["Lower and press up to lockout.","At the top, push the floor further away to round your upper back slightly.","Return to the neutral plank and repeat."]'::jsonb,
  '["Finish every rep with the extra push.","Keep your hips level."]'::jsonb,
  '["Skipping the extra reach at the top."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'push-up-plus'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Forearms slide up a wall to train shoulder blade control and overhead range.', 'Stand with your back and forearms against a wall, elbows at shoulder height and bent to 90°.',
  '["Keep your forearms and hands in contact with the wall.","Slide your arms up as far as you can without arching your back.","Lower back to the start."]'::jsonb,
  '["Ribs stay down.","Shoulders stay away from your ears."]'::jsonb,
  '["Arching the lower back to reach higher."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'wall-slide'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated machine press for the shoulders and triceps.', 'Adjust the seat so the handles start at about shoulder height; back flat against the pad.',
  '["Grip the handles and brace your abs.","Press up until your arms are nearly straight.","Lower under control to the start."]'::jsonb,
  '["Ribs down.","Shoulders stay away from your ears."]'::jsonb,
  '["Arching the back to push the weight up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'machine-shoulder-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Dumbbell bench press with palms facing each other, easier on the shoulders.', 'Lie on a flat bench with dumbbells at your chest, palms facing in, feet planted.',
  '["Press the dumbbells up until your arms are straight.","Lower under control to chest level.","Keep your elbows tucked at about 45°."]'::jsonb,
  '["Shoulder blades pinched and down.","Wrists stay stacked over elbows."]'::jsonb,
  '["Letting the dumbbells drift out of line with your chest."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'db-bench-neutral'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Incline dumbbell press with palms facing each other, targeting the upper chest.', 'Set the bench to a low incline; hold dumbbells at your upper chest, palms facing in.',
  '["Press the dumbbells up and slightly together.","Lower under control to your upper chest.","Keep your elbows tucked."]'::jsonb,
  '["Shoulder blades pinched and down.","Keep your wrists straight."]'::jsonb,
  '["Setting the bench so steep that it becomes a shoulder press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'db-bench-incline-neutral'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bench press with one dumbbell, which adds an anti-rotation demand on the trunk.', 'Lie on a bench with one dumbbell at your chest; plant your feet and brace to stay level.',
  '["Press the dumbbell up over your chest.","Lower it under control while keeping your torso square.","Finish all reps, then switch arms."]'::jsonb,
  '["Don''t let the torso twist toward the weight.","Keep your shoulder blade set."]'::jsonb,
  '["Rotating the body to help the press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'db-bench-single-arm'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Dumbbell press from the floor, limiting the bottom range and loading the triceps.', 'Lie on the floor with knees bent and dumbbells held above your chest.',
  '["Lower the dumbbells until your upper arms touch the floor.","Pause briefly without relaxing.","Press back up to lockout."]'::jsonb,
  '["Elbows at about 45°.","Stop the dumbbells at the floor, don''t bounce."]'::jsonb,
  '["Bouncing the elbows off the floor."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'db-floor-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing press with cables that trains the chest while the trunk resists rotation.', 'Set the handles at chest height, face away from the stack and step into a split stance.',
  '["Hold the handles at your chest with elbows slightly back.","Press forward until your arms are straight.","Return slowly to the start."]'::jsonb,
  '["Ribs down.","Stay tall without leaning into the press."]'::jsonb,
  '["Leaning forward and using body weight."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-chest-press-standing'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated press on a bench or machine seat using cables.', 'Set the handles at chest height and sit with your back supported, handles at your chest.',
  '["Press the handles forward until your arms are straight.","Squeeze your chest at the end.","Return slowly to the start."]'::jsonb,
  '["Shoulder blades stay back against the pad.","Elbows at about 45°."]'::jsonb,
  '["Letting the shoulders roll forward at lockout."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-chest-press-seated'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated machine press on an incline path for the upper chest.', 'Adjust the seat so the handles line up with your upper chest; back flat on the pad.',
  '["Press the handles up and forward until your arms are almost straight.","Pause briefly.","Return under control."]'::jsonb,
  '["Shoulder blades stay back.","Elbows at about 45°."]'::jsonb,
  '["Letting the shoulders shrug forward."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'machine-chest-press-incline'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Single-arm overhead press with a kettlebell.', 'Clean the kettlebell to the rack position at your shoulder, forearm vertical.',
  '["Brace your abs and glutes.","Press the kettlebell straight up past your face.","Lock out overhead, then lower to the rack."]'::jsonb,
  '["Bell stays close to your body.","Ribs down."]'::jsonb,
  '["Leaning back to finish the press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Press with the kettlebell held upside down, which demands grip and shoulder stability.', 'Hold the kettlebell by the handle upside down at your shoulder, forearm vertical.',
  '["Squeeze the handle hard.","Press the bell straight up.","Lower slowly while keeping the bell balanced."]'::jsonb,
  '["Wrist stays stacked over the elbow.","Use a lighter weight than a normal press."]'::jsonb,
  '["Letting the bell tilt away from your forearm."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-press-bottoms-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bench press with a pause just above the chest to build control off the bottom.', 'Set up as for a bench press, bar unracked over your chest.',
  '["Lower the bar under control.","Stop about an inch above your chest and hold for a second.","Press back up."]'::jsonb,
  '["Stay tight through the pause.","Don''t touch or bounce."]'::jsonb,
  '["Relaxing the upper back during the pause."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'spoto-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bench press from a dead stop on safety pins to train drive off the chest.', 'Set the pins just below the bottom of your normal range and lie under the bar.',
  '["Lower the bar onto the pins and settle without relaxing.","Reset your tension.","Press explosively back up."]'::jsonb,
  '["Reset every rep.","Stay tight on the pins."]'::jsonb,
  '["Resting fully on the pins."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pin-press-bench'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Short-range bench press using a board on the chest to overload the lockout.', 'Have a partner hold a board on your chest or use a block you can touch.',
  '["Lower the bar until it touches the board.","Press up to full lockout.","Keep the elbows tucked."]'::jsonb,
  '["Stay tight, don''t bounce.","Drive your feet into the floor."]'::jsonb,
  '["Letting the shoulders collapse at the board."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'board-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull-up with a wide overhand grip that emphasizes the lats.', 'Hang from the bar with hands wider than your shoulders, overhand grip.',
  '["Pull your shoulder blades down.","Pull your chest toward the bar.","Lower to a full hang under control."]'::jsonb,
  '["Lead with your chest.","Elbows travel down to your sides."]'::jsonb,
  '["Cutting the range short at the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pull-up-wide'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull-up on rings, which lets the hands rotate and builds extra stability.', 'Hang from rings set high enough to clear the floor.',
  '["Pull your shoulder blades down.","Pull up while turning your palms toward each other.","Lower to a full hang under control."]'::jsonb,
  '["Keep the rings close to your body.","Control the swing."]'::jsonb,
  '["Letting the rings swing wide."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pull-up-ring'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull-up with a counterweight to help you through the full range.', 'Choose an assistance weight, kneel or stand on the platform and grip the bar.',
  '["Pull your shoulder blades down.","Pull your chest toward the bar.","Lower under control to a full hang."]'::jsonb,
  '["Lead with your chest.","Reduce the assistance as you get stronger."]'::jsonb,
  '["Using so much assistance that the lats are barely working."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pull-up-assisted-machine'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull-up with a band under the feet or knees to help through the range.', 'Loop a resistance band over the bar and put a foot or knee in it, then hang.',
  '["Pull your shoulder blades down.","Pull your chest toward the bar.","Lower under control to a full hang."]'::jsonb,
  '["Use a thinner band as you get stronger.","Full range every rep."]'::jsonb,
  '["Bouncing out of the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pull-up-band-assisted'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Lat pulldown with a wide overhand grip.', 'Adjust the thigh pad, grip the bar wider than your shoulders and sit tall.',
  '["Pull your shoulder blades down.","Pull the bar to your upper chest.","Return slowly until your arms are straight."]'::jsonb,
  '["Drive your elbows down.","Chest tall."]'::jsonb,
  '["Leaning far back and pulling with momentum."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'lat-pulldown-wide-overhand'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Lat pulldown with an underhand grip that adds biceps involvement.', 'Adjust the thigh pad, grip the bar shoulder-width with palms facing you.',
  '["Pull your shoulder blades down.","Pull the bar to your upper chest, elbows by your ribs.","Return slowly until your arms are straight."]'::jsonb,
  '["Elbows stay close to your sides.","Chest tall."]'::jsonb,
  '["Using the arms only and skipping the shoulder blade pull."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'lat-pulldown-underhand'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Machine row with handles above chest height that works the upper back and lats.', 'Adjust the seat and chest pad so you can reach the handles with straight arms.',
  '["Pull the handles toward your upper chest.","Squeeze your shoulder blades together.","Return slowly."]'::jsonb,
  '["Chest stays on the pad.","Elbows drive down and back."]'::jsonb,
  '["Shrugging the shoulders toward your ears."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'machine-high-row'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'One-arm cable row that lets each side work through a full range.', 'Set the handle at about waist height, hinge slightly and hold the handle with one arm.',
  '["Keep your torso square and still.","Pull the handle to your ribs.","Return slowly until your arm is straight."]'::jsonb,
  '["Don''t rotate your torso.","Elbow drives back along your ribs."]'::jsonb,
  '["Twisting the torso to pull more weight."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-row-single-arm'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated cable row with a rope for a wider finish and rear-shoulder work.', 'Attach a rope to a low pulley, sit tall with your knees slightly bent and hold the ends.',
  '["Pull the rope to your upper abdomen, elbows flaring slightly.","Squeeze your shoulder blades together.","Return slowly."]'::jsonb,
  '["Chest tall.","Pull with your back, not your arms."]'::jsonb,
  '["Rocking your torso to move the weight."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-row-rope'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bent-over row on a Smith machine, with the bar path fixed.', 'Stand with the bar over your mid-foot, hinge at the hips and grip the bar overhand.',
  '["Brace your abs and keep your back flat.","Pull the bar to your lower ribs.","Lower under control."]'::jsonb,
  '["Torso stays still.","Elbows drive back."]'::jsonb,
  '["Standing up out of the hinge as the weight gets heavy."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'smith-row'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'T-bar row with your chest on a pad, removing the lower back from the lift.', 'Lie chest-down on the pad and grip the handles.',
  '["Pull the handles toward your lower ribs.","Squeeze your shoulder blades together.","Lower under control."]'::jsonb,
  '["Chest stays on the pad.","Elbows drive back."]'::jsonb,
  '["Lifting the chest off the pad to complete reps."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 't-bar-row-chest-supported'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Dead hang from towels to train grip endurance.', 'Drape two towels over a pull-up bar and hold the ends, hands shoulder-width apart.',
  '["Hang with straight arms and your shoulders engaged.","Hold for the planned time.","Step down carefully."]'::jsonb,
  '["Squeeze the towels hard.","Keep your shoulders down."]'::jsonb,
  '["Letting the shoulders shrug up to the ears."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'towel-hang'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Dead hang on a thick bar or grip aid to train grip strength.', 'Wrap a thick-grip tool around the bar, or use a fat bar, and hang with straight arms.',
  '["Hang with your shoulders engaged.","Hold for the planned time.","Step down carefully."]'::jsonb,
  '["Squeeze evenly with all fingers.","Keep your shoulders down."]'::jsonb,
  '["Letting the hands slide to the fingertips."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'fat-grip-dead-hang'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Overhand curl that works the forearms and the biceps'' outer side.', 'Hold an EZ bar with an overhand grip, arms by your sides.',
  '["Curl the bar up without letting your wrists bend back.","Pause at the top.","Lower slowly."]'::jsonb,
  '["Keep your elbows at your sides.","Wrists stay straight."]'::jsonb,
  '["Swinging the body to lift the bar."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'reverse-curl-ez'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hammer curl across the body, hitting the biceps and forearm.', 'Stand with dumbbells at your sides, palms facing in.',
  '["Curl one dumbbell across your chest toward the opposite shoulder.","Lower slowly.","Alternate arms."]'::jsonb,
  '["Elbow stays at your side.","Slow lowering."]'::jsonb,
  '["Swinging the weight up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'hammer-curl-cross-body'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Curl up with palms up, then lower with palms down to train the biceps and forearms.', 'Stand with dumbbells at your sides, palms facing forward.',
  '["Curl the dumbbells up with palms up.","At the top, rotate your palms to face down.","Lower slowly, then rotate back to palms up."]'::jsonb,
  '["Lower slowly.","Elbows stay at your sides."]'::jsonb,
  '["Rushing the lowering phase."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'zottman-curl'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Single-arm cable curl facing away from the stack for a long, stretched start.', 'Set the handle low, face away from the stack and step forward so your arm is behind your body.',
  '["Start with the arm extended behind you.","Curl the handle up toward your shoulder.","Lower slowly to the stretch."]'::jsonb,
  '["Keep your elbow still.","Feel the stretch at the bottom."]'::jsonb,
  '["Letting the elbow move forward to lift."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-curl-bayesian'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing curl with a straight cable bar.', 'Attach a straight bar to a low pulley and stand tall holding it with an underhand grip.',
  '["Curl the bar toward your shoulders.","Squeeze at the top.","Lower slowly."]'::jsonb,
  '["Elbows stay at your sides.","Stand tall."]'::jsonb,
  '["Leaning back to curl."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-curl-bar'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Curl on a preacher pad that fixes the upper arm.', 'Adjust the seat so your upper arms rest on the pad, then grip the handles.',
  '["Curl the handles up toward your shoulders.","Squeeze at the top.","Lower until your arms are nearly straight."]'::jsonb,
  '["Armpits stay at the top of the pad.","Slow lowering."]'::jsonb,
  '["Lifting the elbows off the pad."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'preacher-curl-machine'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'One-arm cable pushdown for even triceps work.', 'Set the handle high, hold it with one hand and pin your elbow at your side.',
  '["Press the handle down until your arm is straight.","Squeeze your triceps.","Return slowly."]'::jsonb,
  '["Elbow stays pinned.","Don''t rotate your torso."]'::jsonb,
  '["Letting the shoulder drift forward."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'pushdown-single-arm'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Triceps extension that sends a dumbbell across the body for a stretched triceps.', 'Lie on a bench with a dumbbell held over your shoulder.',
  '["Lower the dumbbell toward the opposite shoulder by bending your elbow.","Extend back to straight.","Finish all reps, then switch."]'::jsonb,
  '["Upper arm stays still.","Control the weight over your face."]'::jsonb,
  '["Letting the upper arm drift forward."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'tri-ext-cross-body-db'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated machine press that trains the triceps and lower chest.', 'Adjust the seat and handles so your elbows start by your sides.',
  '["Press the handles down until your arms are straight.","Pause.","Return slowly."]'::jsonb,
  '["Shoulders stay down.","Elbows close to your body."]'::jsonb,
  '["Shrugging your shoulders as you press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'dip-machine'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bent-over dumbbell raise for the rear shoulders.', 'Hinge forward with a flat back, dumbbells hanging beneath you.',
  '["Raise the dumbbells out to the sides with soft elbows.","Pause at shoulder height.","Lower slowly."]'::jsonb,
  '["Lead with your elbows.","Keep your neck relaxed."]'::jsonb,
  '["Using momentum from the hips."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'lateral-raise-bent-over-db'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Cable fly that trains the rear shoulders through a smooth path.', 'Set two handles at shoulder height, cross the cables and take each handle with the opposite hand.',
  '["Pull the handles apart with soft elbows.","Squeeze your shoulder blades gently.","Return slowly."]'::jsonb,
  '["Lead with your elbows.","Keep your torso still."]'::jsonb,
  '["Pulling with the arms bent and the shoulders shrugging."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-rear-delt-fly'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Lateral raise with the cable passing behind your body for tension at the bottom.', 'Set a low pulley, stand sideways and hold the handle with the far hand across behind you.',
  '["Raise your arm out to the side to shoulder height.","Pause briefly.","Lower slowly."]'::jsonb,
  '["Lead with your elbow.","Don''t lean."]'::jsonb,
  '["Swinging the torso."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'lateral-raise-cable-behind-back'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Cable raise to a Y shape for the side and rear shoulders and upper back.', 'Set the pulleys low and hold each handle across your body.',
  '["Raise your arms out and up into a Y overhead.","Pause at the top.","Lower slowly."]'::jsonb,
  '["Thumbs point up.","Ribs stay down."]'::jsonb,
  '["Arching the back to raise higher."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-y-raise'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'One-leg press that shows and fixes side-to-side differences.', 'Sit in the leg press with one foot centered on the platform, the other foot off.',
  '["Lower the sled until your knee is at about 90°.","Press back up without locking out.","Finish all reps, then switch legs."]'::jsonb,
  '["Hips stay down on the seat.","Knee tracks over the toes."]'::jsonb,
  '["Letting the hips curl off the seat at the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'leg-press-single-leg'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hack squat facing the pad, which shifts work toward the glutes.', 'Stand on the platform facing the pad, chest against it, feet shoulder-width.',
  '["Lower until your thighs are about parallel.","Keep your chest against the pad.","Drive through your feet to stand."]'::jsonb,
  '["Knees track over the toes.","Stay controlled at the bottom."]'::jsonb,
  '["Bouncing at the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'hack-squat-reverse'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Goblet squat with your heels raised to put more load on the quads.', 'Stand with your heels on a plate or wedge, holding a weight at your chest.',
  '["Brace your abs.","Sit straight down between your knees.","Drive back up to stand."]'::jsonb,
  '["Chest tall.","Knees track over the toes."]'::jsonb,
  '["Letting the heels roll off the support."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'heel-elevated-goblet-squat'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Sideways step-up that trains the glutes and legs in the frontal plane.', 'Stand sideways next to a box or step, near foot on top.',
  '["Press through the top foot to stand on the box.","Lower the trailing foot under control.","Finish all reps, then switch."]'::jsonb,
  '["Use the top leg, not the push-off leg.","Hips stay square."]'::jsonb,
  '["Pushing off the floor foot."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'step-up-lateral'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Single-leg squat with the back foot held behind you.', 'Stand on one leg and hold your other foot behind you.',
  '["Lower until your back knee lightly touches the floor.","Keep your torso upright.","Drive back up through the front foot."]'::jsonb,
  '["Control the descent.","Hold the foot only for balance."]'::jsonb,
  '["Dropping fast into the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'shrimp-squat'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Front squat straight into an overhead press with a barbell.', 'Hold the bar in the front rack, feet shoulder-width.',
  '["Squat to full depth with your chest tall.","Drive up and press the bar overhead in one motion.","Lower the bar to the rack and repeat."]'::jsonb,
  '["Use the leg drive to help the press.","Finish with the bar over your mid-foot."]'::jsonb,
  '["Pressing before the legs have finished driving."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'thruster-bb'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Squat straight into an overhead press with dumbbells.', 'Hold dumbbells at your shoulders, feet shoulder-width.',
  '["Squat to full depth with your chest tall.","Drive up and press the dumbbells overhead.","Lower them to your shoulders and repeat."]'::jsonb,
  '["Use the leg drive to help the press.","Keep the dumbbells close to your body."]'::jsonb,
  '["Pressing before the legs have finished driving."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'thruster-db'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Squat with the bar held overhead, demanding shoulder and hip mobility.', 'Take a wide snatch grip and lock the bar overhead with arms straight.',
  '["Brace your abs and keep the bar over your mid-foot.","Squat to full depth with your chest tall.","Drive up while keeping the bar locked out."]'::jsonb,
  '["Arms stay locked out.","Bar stays over your mid-foot."]'::jsonb,
  '["Letting the bar drift forward."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'overhead-squat'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Kettlebell lift from the floor that teaches the hip hinge.', 'Place a kettlebell between your feet and hinge to grip the handle.',
  '["Brace your abs and flatten your back.","Drive through your feet to stand tall.","Lower by hinging back to the floor."]'::jsonb,
  '["Hips move back first.","Squeeze your glutes at the top."]'::jsonb,
  '["Rounding the back to reach the bell."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-deadlift'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Romanian deadlift using a trap bar, which keeps the load close to the body.', 'Stand inside the trap bar holding the handles with the bar at hip height.',
  '["Hinge your hips back with soft knees.","Lower until you feel a strong hamstring stretch.","Drive your hips forward to stand tall."]'::jsonb,
  '["Back stays flat.","Bar stays close to your legs."]'::jsonb,
  '["Squatting the weight instead of hinging."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'rdl-trap-bar'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Machine hip thrust for the glutes with a fixed path.', 'Sit in the machine with your upper back against the pad and the belt across your hips.',
  '["Drive through your feet to lift your hips.","Squeeze your glutes at the top.","Lower under control."]'::jsonb,
  '["Chin tucked.","Ribs stay down."]'::jsonb,
  '["Arching the lower back at the top."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'hip-thrust-machine'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hip thrust with a dumbbell on your hips.', 'Sit with your upper back on a bench and a dumbbell resting across your hips.',
  '["Drive through your feet to lift your hips.","Squeeze your glutes at the top.","Lower under control."]'::jsonb,
  '["Chin tucked.","Shins vertical at the top."]'::jsonb,
  '["Overextending the lower back at the top."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'hip-thrust-db'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bodyweight hamstring and glute lift on a glute-ham bench.', 'Lock your feet into the bench and set the pad at your hips.',
  '["Lower your torso with a straight body.","Pull yourself back up with your hamstrings and glutes.","Keep your hips extended throughout."]'::jsonb,
  '["Body stays in one line.","Control the descent."]'::jsonb,
  '["Bending at the hips instead of staying straight."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'glute-ham-raise'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Deadlift with a snatch-wide grip for extra range and upper-back work.', 'Take a wide overhand grip on the bar, hips lower than a normal deadlift.',
  '["Brace your abs and keep your chest up.","Push the floor away until you''re standing tall.","Lower the bar under control."]'::jsonb,
  '["Keep the bar close to your legs.","Keep your back flat."]'::jsonb,
  '["Letting the hips shoot up before the bar moves."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'snatch-grip-deadlift'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Calf raise performed on a leg press machine.', 'Sit in the leg press with the balls of your feet on the platform edge, legs straight.',
  '["Press through your toes to rise as high as you can.","Pause at the top.","Lower slowly to a full stretch."]'::jsonb,
  '["Knees stay nearly straight.","Pause at the stretch."]'::jsonb,
  '["Bouncing at the bottom."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'calf-raise-leg-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing calf raise on a Smith machine.', 'Place the balls of your feet on a step under the bar and set the bar on your shoulders.',
  '["Rise up as high as you can.","Pause at the top.","Lower slowly to a full stretch."]'::jsonb,
  '["Pause at the stretch.","Keep your knees almost straight."]'::jsonb,
  '["Rushing the reps."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'calf-raise-smith'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Bent-over calf raise that stretches the calf under load.', 'Stand with the balls of your feet on a step, hinged forward with your hands braced on a support.',
  '["Rise up as high as you can.","Pause at the top.","Lower slowly to a deep stretch."]'::jsonb,
  '["Full stretch at the bottom.","Keep your knees almost straight."]'::jsonb,
  '["Cutting the range short."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'calf-raise-donkey'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Banded ankle eversion that strengthens the outer ankle.', 'Sit with a band around the forefoot of one foot, anchored on the inside.',
  '["Turn your foot outward against the band.","Pause.","Return slowly."]'::jsonb,
  '["Move only at the ankle.","Slow return."]'::jsonb,
  '["Rotating the whole leg instead of the ankle."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'peroneal-raise-band'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing cable move that pulls the leg inward to train the inner thigh.', 'Attach the ankle cuff to a low pulley and stand sideways to the stack with the working leg nearest.',
  '["Pull the leg across in front of the other leg.","Pause.","Return slowly."]'::jsonb,
  '["Torso stays upright.","Hips stay square."]'::jsonb,
  '["Leaning away to swing the leg."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-hip-adduction'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Banded knee straightening that trains the quads near full extension.', 'Loop a band behind one knee and anchor it in front, with the knee slightly bent.',
  '["Straighten the knee against the band.","Squeeze your quad.","Return slowly."]'::jsonb,
  '["Lock the knee fully.","Slow return."]'::jsonb,
  '["Bending at the hips instead of moving at the knee."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'terminal-knee-extension-band'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Isometric squeeze of a ball between the knees for the inner thighs.', 'Lie on your back with knees bent and a ball between your knees.',
  '["Squeeze the ball with your inner thighs.","Hold for the planned time.","Release slowly."]'::jsonb,
  '["Breathe normally.","Keep your hips down."]'::jsonb,
  '["Holding your breath."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'adductor-squeeze-ball'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hamstring bridge that walks the feet away from the hips.', 'Lie on your back with knees bent and heels near your hips, then lift into a bridge.',
  '["Walk your feet out one step at a time.","Keep your hips high.","Walk back in and lower."]'::jsonb,
  '["Hips stay high.","Small controlled steps."]'::jsonb,
  '["Letting the hips drop as the feet move away."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'bridge-walkout'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull the bar from the floor and catch it on your shoulders.', 'Stand with the bar over your mid-foot, hands just outside your knees.',
  '["Pull the bar off the floor, keeping your back flat.","Extend your hips and shrug hard.","Drop under the bar and catch it in the front rack."]'::jsonb,
  '["Keep the bar close to your body.","Elbows fast around the bar."]'::jsonb,
  '["Pulling with the arms before the hips have extended."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'clean'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Lift the bar from the floor to overhead in one motion.', 'Take a wide overhand grip with the bar over your mid-foot.',
  '["Pull the bar off the floor with a flat back.","Extend your hips and shrug.","Drop under the bar and catch it overhead with locked arms."]'::jsonb,
  '["Keep the bar close to your body.","Lock out firmly overhead."]'::jsonb,
  '["Pulling with the arms too early."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'snatch'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Clean the bar to your shoulders, then drive it overhead.', 'Stand with the bar over your mid-foot, hands just outside your knees.',
  '["Clean the bar to the front rack.","Dip and drive your legs to push the bar up.","Split or drop under the bar and lock it out overhead."]'::jsonb,
  '["Keep the dip vertical.","Lock out firmly."]'::jsonb,
  '["Pressing the bar instead of driving with the legs."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'clean-and-jerk'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Clean the bar to your shoulders, then press it overhead.', 'Stand with the bar over your mid-foot, hands just outside your knees.',
  '["Clean the bar to the front rack.","Brace your abs and press the bar overhead.","Lower back to the shoulders, then the floor."]'::jsonb,
  '["Brace before the press.","Keep your ribs down."]'::jsonb,
  '["Leaning back to finish the press."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'clean-and-press'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Explosive pull of dumbbells from the hip to your shoulders.', 'Hold dumbbells at your thighs, hinge slightly.',
  '["Hinge back, then drive your hips forward.","Shrug and pull the dumbbells up.","Catch them on your shoulders with soft knees."]'::jsonb,
  '["Keep the weights close.","Let the hips do the work."]'::jsonb,
  '["Curling the dumbbells up with the arms."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'db-hang-clean'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Pull a kettlebell from a hinge to the rack position in one smooth motion.', 'Hold a kettlebell between your legs, hinged slightly.',
  '["Hike the bell back, then drive your hips forward.","Keep the bell close as it travels up.","Catch it in the rack with your forearm vertical."]'::jsonb,
  '["Keep your arm close to your body.","Soft catch."]'::jsonb,
  '["Letting the bell swing out and bang the forearm."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-clean'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'One-arm kettlebell swing driven by the hips.', 'Hold a kettlebell with one hand, feet shoulder-width, hinged forward.',
  '["Hike the bell back between your legs.","Snap your hips forward to swing the bell to chest height.","Let it fall back into the hinge."]'::jsonb,
  '["Arm is a rope; hips do the work.","Don''t let your torso rotate."]'::jsonb,
  '["Lifting the bell with the arm."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-swing-single-arm'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Get from lying to standing while holding a weight overhead.', 'Lie on your back holding a kettlebell straight up with one hand, same-side knee bent.',
  '["Roll to your elbow, then your hand.","Lift your hips and sweep your leg back to kneel.","Stand up, then reverse the steps."]'::jsonb,
  '["Eyes on the weight.","Arm stays vertical."]'::jsonb,
  '["Rushing through the stages."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'turkish-get-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Loaded side bend and hinge with a weight overhead.', 'Press a kettlebell overhead, turn your feet slightly out and keep your eyes on the bell.',
  '["Push your hip out to the side.","Hinge down with the free hand sliding down the leg.","Return to standing."]'::jsonb,
  '["Arm stays vertical.","Keep eyes on the bell."]'::jsonb,
  '["Bending the arm instead of hinging."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'kb-windmill'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Walk while holding a sandbag.', 'Lift a sandbag to your chest or shoulder.',
  '["Brace your abs and stand tall.","Walk with short, steady steps.","Set it down under control."]'::jsonb,
  '["Stay tall.","Keep your steps even."]'::jsonb,
  '["Leaning back to balance the load."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'carry-sandbag'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Walk with a sandbag wrapped in a bear hug against your chest.', 'Lift the sandbag and wrap both arms around it, high on your chest.',
  '["Squeeze the bag into your chest.","Walk with short, steady steps.","Set it down under control."]'::jsonb,
  '["Squeeze throughout.","Stay tall."]'::jsonb,
  '["Letting the bag slip down toward your waist."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'carry-bear-hug-sandbag'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Walk with weights held at your shoulders.', 'Hold two kettlebells or dumbbells in the front rack position.',
  '["Brace your abs and keep your elbows tucked.","Walk with short, steady steps.","Set the weights down under control."]'::jsonb,
  '["Stay tall.","Don''t lean back."]'::jsonb,
  '["Letting the ribs flare out."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'carry-front-rack'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Basic floor crunch for the abs.', 'Lie on your back with knees bent and hands by your head.',
  '["Curl your ribs toward your hips.","Pause at the top.","Lower slowly."]'::jsonb,
  '["Chin stays off your chest.","Move at the ribs, not the neck."]'::jsonb,
  '["Pulling on your head."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'crunch-floor'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Full sit-up for the abs and hip flexors.', 'Lie on your back with knees bent and feet anchored or flat.',
  '["Curl up until your torso is upright.","Lower slowly back down.","Keep your feet grounded."]'::jsonb,
  '["Move smoothly.","Don''t yank on your neck."]'::jsonb,
  '["Using momentum to swing up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'sit-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Lift legs and torso together to meet in a V.', 'Lie flat with your legs straight and arms overhead.',
  '["Raise your arms and legs together.","Reach your hands toward your feet at the top.","Lower slowly."]'::jsonb,
  '["Control the lowering.","Keep legs straight."]'::jsonb,
  '["Swinging from momentum."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'v-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Seated rotation that trains the obliques.', 'Sit with knees bent, leaning back slightly with your feet raised or down.',
  '["Brace your abs.","Rotate your torso to one side.","Rotate to the other side."]'::jsonb,
  '["Turn from the ribs, not the arms.","Keep your chest tall."]'::jsonb,
  '["Moving only the arms."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'russian-twist'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Rotational cable pull across the body.', 'Set a cable high or low and stand sideways to the stack.',
  '["Hold the handle with both hands.","Rotate your torso and pull across your body.","Return slowly."]'::jsonb,
  '["Turn from your hips and ribs.","Arms stay mostly straight."]'::jsonb,
  '["Pulling with the arms alone."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'cable-woodchop'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing rotation with a barbell anchored in a landmine.', 'Hold the end of a landmine bar at chest height with both hands, feet shoulder-width.',
  '["Rotate the bar to one side with your torso.","Pivot your back foot as you turn.","Rotate to the other side."]'::jsonb,
  '["Turn with your hips and ribs.","Arms stay mostly straight."]'::jsonb,
  '["Swinging the bar with the arms."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'landmine-rotation'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hold your legs straight out in front while supported on your hands.', 'Place your hands on parallettes, blocks or the floor.',
  '["Push down and lift your hips off the floor.","Hold your legs straight in front of you.","Lower under control."]'::jsonb,
  '["Push the floor away.","Point your toes."]'::jsonb,
  '["Letting the shoulders shrug up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'l-sit'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Fast knee drives from a plank position.', 'Start in a plank with your hands under your shoulders.',
  '["Drive one knee toward your chest.","Switch legs quickly.","Keep your hips level."]'::jsonb,
  '["Hips stay low and level.","Shoulders stay over your hands."]'::jsonb,
  '["Raising the hips as you speed up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'mountain-climber'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Crawl forward on hands and feet with knees just off the floor.', 'Start on all fours with your knees hovering an inch off the floor.',
  '["Move your opposite hand and foot forward together.","Keep your back flat.","Crawl for the planned distance."]'::jsonb,
  '["Knees stay low.","Hips stay level."]'::jsonb,
  '["Bouncing the hips up and down."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'bear-crawl'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Raise straight legs from the floor for the lower abs.', 'Lie on your back with your legs straight and hands under your hips.',
  '["Press your lower back down.","Raise your legs to vertical.","Lower slowly without letting your back arch."]'::jsonb,
  '["Lower back stays down.","Slow lowering."]'::jsonb,
  '["Letting the lower back arch as the legs lower."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'lying-leg-raise'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Standing side bend with one dumbbell.', 'Stand tall holding a dumbbell in one hand.',
  '["Bend sideways toward the weight.","Return to upright, then lean slightly to the other side.","Finish all reps, then switch."]'::jsonb,
  '["Bend only at the side.","Move slowly."]'::jsonb,
  '["Leaning forward or back."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'side-bend-db'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hanging leg sweep from side to side that trains rotation control.', 'Hang from a bar and lift your legs to horizontal.',
  '["Rotate your legs to one side.","Bring them back to the middle.","Rotate to the other side."]'::jsonb,
  '["Keep your arms straight.","Move under control."]'::jsonb,
  '["Swinging from momentum."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'windshield-wiper-hanging'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Small, spine-friendly curl-up with one knee bent.', 'Lie on your back with one knee bent and your hands under your lower back.',
  '["Brace your abs.","Lift your head and shoulders slightly.","Hold, then lower."]'::jsonb,
  '["Keep a neutral spine.","Lift only a little."]'::jsonb,
  '["Flexing the whole spine to sit up."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'mcgill-curl-up'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Forward neck strengthening against light resistance.', 'Lie on your back or sit with a hand or weight at your forehead.',
  '["Tuck your chin slightly.","Press your head forward against the resistance.","Return slowly."]'::jsonb,
  '["Use a light load.","Move through a small range."]'::jsonb,
  '["Using too much load."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'neck-flexion'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Backward neck strengthening against light resistance.', 'Lie face down on a bench with your head over the edge, or sit with a hand behind your head.',
  '["Lift your head back against the resistance.","Pause.","Return slowly."]'::jsonb,
  '["Use a light load.","Move through a small range."]'::jsonb,
  '["Using too much load."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'neck-extension'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Fan-bike intervals using arms and legs.', 'Adjust the seat so your leg is almost straight at the bottom of the pedal stroke.',
  '["Warm up for a few minutes.","Work hard for the interval, pushing and pulling the handles.","Recover easily between intervals."]'::jsonb,
  '["Push and pull evenly.","Control your breathing in the recovery."]'::jsonb,
  '["Starting the first interval too hard."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'assault-bike-intervals'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Steady easy effort on a fan bike.', 'Adjust the seat so your leg is almost straight at the bottom of the pedal stroke.',
  '["Settle into a pace where you can speak in sentences.","Hold it for the planned time.","Cool down easy."]'::jsonb,
  '["Keep a steady pace.","Keep your breathing easy."]'::jsonb,
  '["Pushing too hard for an easy session."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'assault-bike-z2'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Brisk walk on an incline treadmill.', 'Set the treadmill to a moderate incline and a walking pace.',
  '["Stand tall and let your arms swing.","Hold a steady pace.","Reduce the incline for a cooldown."]'::jsonb,
  '["Don''t hold the rails.","Keep your steps even."]'::jsonb,
  '["Holding the rails and leaning back."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'walk-incline-treadmill'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Easy walk at a relaxed pace.', 'Choose comfortable shoes and a safe route.',
  '["Walk at a relaxed pace.","Stay tall and swing your arms.","Keep it easy for the planned time."]'::jsonb,
  '["Breathe easily.","Keep it relaxed."]'::jsonb,
  '[]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'walk-easy'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Walk on trails or uneven ground.', 'Wear shoes with grip and bring water.',
  '["Walk at a steady pace.","Use shorter steps on climbs.","Watch your footing on descents."]'::jsonb,
  '["Keep an even pace.","Use short steps downhill."]'::jsonb,
  '[]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'hike'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Easy trail run at a conversational effort.', 'Choose a trail and wear shoes with good grip.',
  '["Run at a pace where you can talk.","Walk steep climbs if needed.","Watch your footing."]'::jsonb,
  '["Keep the effort easy.","Look a few steps ahead."]'::jsonb,
  '["Running too hard on climbs."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'run-z2-trail'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hard treadmill intervals with easy recovery between.', 'Warm up easy for 10 minutes on the treadmill.',
  '["Run hard for the planned interval.","Recover with an easy jog or walk.","Repeat for the planned number of intervals."]'::jsonb,
  '["Hold the same pace each interval.","Keep recovery easy."]'::jsonb,
  '["Starting the first interval too fast."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'run-vo2-treadmill-intervals'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Sustained cycling just below threshold effort.', 'Adjust the bike and warm up for 10 minutes.',
  '["Ride at a hard but sustainable effort.","Hold it for the planned time.","Cool down easy."]'::jsonb,
  '["Keep the effort steady.","Stay seated."]'::jsonb,
  '["Starting above sustainable effort."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'bike-sweet-spot'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Hard ski erg intervals with easy recovery.', 'Stand tall, hold the handles and warm up easy.',
  '["Pull the handles down with your arms and trunk.","Work hard for the interval.","Recover easy between intervals."]'::jsonb,
  '["Hinge from your hips as you pull.","Keep a steady rhythm."]'::jsonb,
  '["Pulling only with the arms."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'ski-erg-intervals'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Alternating or double waves with heavy ropes.', 'Stand with feet shoulder-width, knees slightly bent, holding the rope ends.',
  '["Brace your abs.","Make waves with your arms.","Work for the planned time."]'::jsonb,
  '["Keep your chest up.","Keep the waves even."]'::jsonb,
  '["Moving only the hands."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'battle-ropes'
ON CONFLICT (movement_id) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id, 'Drop to the floor, jump up and repeat.', 'Stand with feet shoulder-width.',
  '["Squat and put your hands on the floor.","Jump your feet back to a plank and lower your chest to the floor.","Press up, jump your feet back in and jump up."]'::jsonb,
  '["Keep your core tight.","Land softly."]'::jsonb,
  '["Letting the hips sag in the plank."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'burpee'
ON CONFLICT (movement_id) DO NOTHING;

-- The push-up is a compound press; it was filed as isolation work.
UPDATE public.movements
SET pattern = 'press',
    secondary_regions = '["elbow_forearm","lumbar_trunk"]'::jsonb,
    secondary_muscles = '{abs}'::public.muscle[],
    functional_roles = array_append(array_remove(functional_roles, 'compound_assistance'), 'compound_assistance')
WHERE user_id IS NULL AND slug = 'push-up';
