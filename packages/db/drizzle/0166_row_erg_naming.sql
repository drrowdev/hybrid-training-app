-- Name every erg the same way ("Ski Erg", "Row Erg") and add the plain Row Erg
-- the library lacked (only the zone/protocol variants existed).
-- Shared catalog only; no schema, permissions or user-history changes. Saved
-- workouts keep the name they were saved with.
UPDATE public.movements
SET display_name = replace(display_name, 'Erg Row — ', 'Row Erg — ')
WHERE user_id IS NULL
  AND slug IN ('erg-z2', 'erg-threshold', 'erg-intervals-500', 'erg-sprints-30-30', 'erg-2k-tt')
  AND display_name LIKE 'Erg Row — %';

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
) VALUES (
  NULL, 'row-erg', 'Row Erg', 'cardio',
  'lumbar_trunk', '["hamstring_posterior","knee","shoulder_scapular"]'::jsonb,
  '{lats,mid_back,quads,hamstrings,glutes}'::public.muscle[],
  '{lower_back,rear_delts,biceps}'::public.muscle[], 'erg', false, 'low_moderate',
  false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true,
  false, 0, 4, '{"modality":"rowing","impact":"very_low"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;
