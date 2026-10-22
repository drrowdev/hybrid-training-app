-- Manual, unused-only rollback for 0167. Run in a maintenance window.
-- Restores the "Sled Push — Heavy" name and the Light row. History that was
-- moved onto the surviving row stays there: it cannot be split back out. Saved
-- workouts keep the shorter name.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
UPDATE public.movements
SET display_name = 'Sled Push — Heavy'
WHERE user_id IS NULL AND slug = 'sled-push-heavy' AND display_name = 'Sled Push';

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, experience_min, experience_max, metadata
)
SELECT NULL, 'sled-push-light', 'Sled Push — Light', pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral,
  body_weight_loaded, 0, experience_max, '{"modality":"sled","emphasis":"Z2-equivalent"}'::jsonb
FROM public.movements
WHERE user_id IS NULL AND slug = 'sled-push-heavy'
ON CONFLICT (user_id, slug) DO NOTHING;
COMMIT;
