-- 0089_seed_prehab_movements.sql
--
-- Add hip-stabiliser (glute-med / frontal plane) + ankle/foot prehab movements
-- that the catalog lacked. The role-coverage audit (migration 0088) found
-- hip_stabilizer / ankle_foot machine-free coverage was thin; these give the
-- durability/functional picker enough non-machine candidates to seat the
-- endurance_anchor requirement (2 each) for a no-equipment user. Roles are the
-- deterministic output of seeds/derive-roles.ts (kept in sync with the seed).

INSERT INTO public.movements (user_id, slug, display_name, pattern, primary_region, secondary_regions, primary_muscles, secondary_muscles, equipment, is_compound, interference_cost, high_strain_tendon, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral, body_weight_loaded, experience_min, experience_max, metadata) VALUES
  (NULL, 'clamshell-band', 'Clamshell (band)', 'isolation', 'hamstring_posterior', '[]'::jsonb, '{"abductors","glutes"}'::muscle[], '{}'::muscle[], 'band', false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 2, '{"emphasis":"glute-med-prehab"}'::jsonb),
  (NULL, 'monster-walk-band', 'Monster Walk (band)', 'isolation', 'hamstring_posterior', '[]'::jsonb, '{"abductors","glutes"}'::muscle[], '{}'::muscle[], 'band', false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"emphasis":"glute-med-prehab"}'::jsonb),
  (NULL, 'side-lying-hip-abduction', 'Side-Lying Hip Abduction', 'isolation', 'hamstring_posterior', '[]'::jsonb, '{"abductors","glutes"}'::muscle[], '{}'::muscle[], 'bodyweight-or-loaded', false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{}'::jsonb),
  (NULL, 'single-leg-glute-bridge', 'Single-Leg Glute Bridge', 'isolation', 'hamstring_posterior', '[]'::jsonb, '{"glutes"}'::muscle[], '{"hamstrings"}'::muscle[], 'bodyweight', false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{"emphasis":"glute-stability"}'::jsonb),
  (NULL, 'fire-hydrant', 'Fire Hydrant', 'isolation', 'hamstring_posterior', '[]'::jsonb, '{"glutes","abductors"}'::muscle[], '{}'::muscle[], 'bodyweight-or-band', false, 'low', false, '{}'::text[], '{"hip_stabilizer"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{}'::jsonb),
  (NULL, 'single-leg-calf-raise', 'Single-Leg Calf Raise', 'isolation', 'foot_ankle_calf', '[]'::jsonb, '{"calves"}'::muscle[], '{}'::muscle[], 'bodyweight-or-loaded', false, 'low', true, '{}'::text[], '{"ankle_foot"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{}'::jsonb),
  (NULL, 'heel-walk', 'Heel Walk', 'isolation', 'foot_ankle_calf', '[]'::jsonb, '{"tibialis"}'::muscle[], '{}'::muscle[], 'bodyweight', false, 'low', false, '{}'::text[], '{"ankle_foot"}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"emphasis":"tibialis-anterior"}'::jsonb),
  (NULL, 'ankle-dorsiflexion-band', 'Banded Dorsiflexion', 'isolation', 'foot_ankle_calf', '[]'::jsonb, '{"tibialis"}'::muscle[], '{}'::muscle[], 'band', false, 'low', false, '{}'::text[], '{"ankle_foot"}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{}'::jsonb),
  (NULL, 'short-foot-drill', 'Short Foot Drill', 'isolation', 'foot_ankle_calf', '[]'::jsonb, '{"tibialis"}'::muscle[], '{}'::muscle[], 'bodyweight', false, 'low', false, '{}'::text[], '{"ankle_foot"}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"emphasis":"foot-intrinsics"}'::jsonb)
ON CONFLICT (user_id, slug) DO UPDATE SET
  display_name = excluded.display_name,
  primary_region = excluded.primary_region,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  equipment = excluded.equipment,
  bilateral = excluded.bilateral,
  high_strain_tendon = excluded.high_strain_tendon,
  bulletproof_roles = excluded.bulletproof_roles,
  functional_roles = excluded.functional_roles,
  metadata = excluded.metadata;
