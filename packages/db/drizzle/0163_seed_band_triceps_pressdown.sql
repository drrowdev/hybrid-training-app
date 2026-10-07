-- Shared catalog only. Classification matches the existing triceps helper;
-- band load handling remains weight-optional, with no resistance-to-kg conversion.
INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'band-triceps-pressdown', 'Band Triceps Pressdown', 'isolation',
  'elbow_forearm', '["shoulder_scapular"]'::jsonb,
  '{triceps}'::public.muscle[], '{}'::public.muscle[], 'band', false, 'low',
  false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"stim_fatigue_ratio":"high"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed
)
SELECT
  id,
  'Standing triceps pressdown with a resistance band.',
  'Secure an undamaged band to a sturdy overhead anchor. Hold the ends with elbows bent and tucked beside your ribs.',
  '["Stand tall with soft knees and the band lightly tensioned.","Keep your upper arms still and straighten your elbows to press the band down.","Pause, then bend your elbows slowly to return."]'::jsonb,
  '["Keep your shoulders relaxed.","Use a pain-free range without snapping your elbows straight."]'::jsonb,
  '["Leaning over the band or swinging your upper arms to move it."]'::jsonb,
  'seed-v1', false
FROM public.movements
WHERE user_id IS NULL AND slug = 'band-triceps-pressdown'
ON CONFLICT (movement_id) DO NOTHING;
