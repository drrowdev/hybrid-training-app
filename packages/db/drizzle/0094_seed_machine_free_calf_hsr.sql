-- 0094_seed_machine_free_calf_hsr.sql
--
-- Add a machine-free Achilles/calf HSR (`hsr-calf-raise-db`) so the
-- running-block Achilles guarantee (ADR 0034 Phase 1) can be satisfied without a
-- calf machine. Previously the only HSR-tagged calf movement (`hsr-calf-raise`)
-- required equipment = 'machine', so a runner with only a bar / dumbbells
-- silently fell back to a knee HSR instead of the calf/Achilles work the floor
-- intends for an impact-loaded runner. Roles are the deterministic output of
-- seeds/derive-roles.ts (hsr from the 3-0-3 tempo; ankle_foot from the calf
-- region + slug). Idempotent.

INSERT INTO public.movements (user_id, slug, display_name, pattern, primary_region, secondary_regions, primary_muscles, secondary_muscles, equipment, is_compound, interference_cost, high_strain_tendon, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral, body_weight_loaded, experience_min, experience_max, metadata) VALUES
  (NULL, 'hsr-calf-raise-db', 'HSR Calf Raise — DB/BW (3s tempo)', 'tendon', 'foot_ankle_calf', '[]'::jsonb, '{"calves"}'::muscle[], '{}'::muscle[], 'dumbbell-or-bw', false, 'low', true, '{"hsr"}'::text[], '{"ankle_foot"}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{"protocol":"Kongsgaard-HSR","tempo":"3-0-3-0","emphasis":"achilles"}'::jsonb)
ON CONFLICT (user_id, slug) DO UPDATE SET
  display_name = excluded.display_name,
  primary_region = excluded.primary_region,
  primary_muscles = excluded.primary_muscles,
  equipment = excluded.equipment,
  bilateral = excluded.bilateral,
  high_strain_tendon = excluded.high_strain_tendon,
  bulletproof_roles = excluded.bulletproof_roles,
  functional_roles = excluded.functional_roles,
  metadata = excluded.metadata;
