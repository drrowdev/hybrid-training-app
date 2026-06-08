-- 0095_seed_forearm_rotation.sql
--
-- Add a forearm ROTATION movement (`db-pronation-supination`) — the sub-pattern
-- the catalogue lacked. The forearm/grip family had wrist FLEXION
-- (wrist-curl-db / wrist-curl-bb) and EXTENSION (reverse-wrist-curl) and grip
-- isometrics, but no pronation/supination, so a `forearms` focus could only
-- duplicate flexion. ADR 0043 makes the focus pass span distinct sub-patterns
-- (flexion → extension → rotation → grip); this gives it the rotation option.
-- Roles are the deterministic output of seeds/derive-roles.ts (a forearm
-- isolation carries none). Idempotent.

INSERT INTO public.movements (user_id, slug, display_name, pattern, primary_region, secondary_regions, primary_muscles, secondary_muscles, equipment, is_compound, interference_cost, high_strain_tendon, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral, body_weight_loaded, experience_min, experience_max, metadata) VALUES
  (NULL, 'db-pronation-supination', 'Pronation / Supination (DB)', 'isolation', 'elbow_forearm', '[]'::jsonb, '{"forearms"}'::muscle[], '{}'::muscle[], 'dumbbell', false, 'low', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', false, false, 0, 4, '{"emphasis":"forearm-rotation"}'::jsonb)
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
