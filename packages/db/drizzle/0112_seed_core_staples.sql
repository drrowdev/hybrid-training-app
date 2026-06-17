-- 0112_seed_core_staples.sql
--
-- Add common core/ab staples the catalog lacked, so they're pickable + swappable
-- in the logging UI's movement search. Surfaced by user feedback (GHD sit-up was
-- missing; the swap/search couldn't find it):
--   - ghd-situp       GHD Sit-Up      (apparatus: GHD — machine-gated)
--   - reverse-crunch  Reverse Crunch  (bodyweight, lower-ab flexion)
--   - decline-situp   Decline Sit-Up  (unweighted counterpart to weighted-decline-situp)
--   - machine-crunch  Machine Crunch  (loaded crunch for commercial gyms)
--
-- All four are trunk-FLEXION movements, so deriveAccessoryRoles assigns no
-- bulletproof/functional roles (anti_extension is reserved for brace work — see
-- seeds/derive-roles.ts). Kept in sync with the seed (seeds/movements-part2.ts).
-- Idempotent.

INSERT INTO public.movements (user_id, slug, display_name, pattern, primary_region, secondary_regions, primary_muscles, secondary_muscles, equipment, is_compound, interference_cost, high_strain_tendon, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral, body_weight_loaded, experience_min, experience_max, metadata) VALUES
  (NULL, 'ghd-situp', 'GHD Sit-Up', 'isolation', 'lumbar_trunk', '[]'::jsonb, '{"abs"}'::muscle[], '{"obliques","quads"}'::muscle[], 'ghd-machine', false, 'low', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, false, 2, 4, '{"emphasis":"trunk-flexion"}'::jsonb),
  (NULL, 'reverse-crunch', 'Reverse Crunch', 'isolation', 'lumbar_trunk', '[]'::jsonb, '{"abs"}'::muscle[], '{"obliques"}'::muscle[], 'bodyweight', false, 'low', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"emphasis":"lower-abs"}'::jsonb),
  (NULL, 'decline-situp', 'Decline Sit-Up', 'isolation', 'lumbar_trunk', '[]'::jsonb, '{"abs"}'::muscle[], '{"obliques"}'::muscle[], 'decline-bench', false, 'low', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"emphasis":"trunk-flexion"}'::jsonb),
  (NULL, 'machine-crunch', 'Machine Crunch', 'isolation', 'lumbar_trunk', '[]'::jsonb, '{"abs"}'::muscle[], '{"obliques"}'::muscle[], 'machine', false, 'low', false, '{}'::text[], '{}'::text[], true, NULL, NULL, 'low', 'supported', true, false, 0, 4, '{}'::jsonb)
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
  is_supported = excluded.is_supported,
  stability = excluded.stability,
  experience_min = excluded.experience_min,
  metadata = excluded.metadata;
