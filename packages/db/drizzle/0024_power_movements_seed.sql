-- 0024_power_movements_seed.sql
-- Seed the 10 power-relevant movements that PR #22 proposed in its
-- "Slugs proposed but not present in the catalog" list. PR #22 only
-- tagged the *existing* power slugs; this migration adds the missing
-- ones so the accessory picker has a real catalog to draw from when
-- `power_emphasis = true`.
--
-- Source seed records: packages/db/seeds/movements-part3.ts §PLYO + §OLYMPIC.
-- Slug `rotational-throw` is skipped — already covered by the existing
-- `med-ball-rotational-throw` row.
--
-- Idempotent: INSERT … ON CONFLICT (user_id, slug) DO NOTHING (the unique
-- constraint is movements_user_id_slug_unique with NULLS NOT DISTINCT,
-- so the NULL user_id rows match by slug). The trailing UPDATE block
-- re-tags functional_roles even if rows pre-existed (e.g. if the seed
-- runner created them before this migration ran).

-- ─── INSERT new rows ──────────────────────────────────────────────
INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound,
  interference_cost, high_strain_tendon, axial_load, stability,
  bilateral, body_weight_loaded, functional_roles, metadata
) VALUES
  -- power_olympic — Olympic / olympic-derivative lifts
  (NULL, 'split-jerk', 'Split Jerk', 'olympic', 'shoulder_scapular',
   '["hamstring_posterior","knee","lumbar_trunk"]'::jsonb,
   ARRAY['front_delts','triceps']::muscle[],
   ARRAY['quads','glutes','abs','side_delts']::muscle[],
   'barbell', true, 'low', true, 'high', 'free', true, false,
   ARRAY['power_olympic']::text[],
   '{"cns_cost":"very_high","emphasis":"split-stance-overhead-power"}'::jsonb),

  (NULL, 'dumbbell-snatch', 'Dumbbell Snatch', 'olympic', 'hamstring_posterior',
   '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
   ARRAY['hamstrings','glutes','front_delts','traps']::muscle[],
   ARRAY['lower_back','abs','quads']::muscle[],
   'dumbbell', true, 'low', true, 'moderate', 'free', false, false,
   ARRAY['power_olympic']::text[],
   '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb),

  (NULL, 'kettlebell-snatch', 'Kettlebell Snatch', 'olympic', 'hamstring_posterior',
   '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
   ARRAY['hamstrings','glutes','front_delts']::muscle[],
   ARRAY['lower_back','abs','traps']::muscle[],
   'kettlebell', true, 'low', true, 'moderate', 'free', false, false,
   ARRAY['power_olympic']::text[],
   '{"cns_cost":"very_high","emphasis":"rate-of-force-development"}'::jsonb),

  -- power_ballistic — KB clean & jerk (posterior chain + overhead)
  (NULL, 'kb-clean-and-jerk', 'Kettlebell Clean & Jerk', 'olympic', 'hamstring_posterior',
   '["knee","lumbar_trunk","shoulder_scapular"]'::jsonb,
   ARRAY['hamstrings','glutes','front_delts','triceps']::muscle[],
   ARRAY['lower_back','abs','traps','quads']::muscle[],
   'kettlebell', true, 'low', true, 'moderate', 'free', true, false,
   ARRAY['power_ballistic']::text[],
   '{"cns_cost":"very_high","emphasis":"posterior-chain-into-overhead"}'::jsonb),

  -- power_plyometric — jump-based SSC work
  (NULL, 'hurdle-hop', 'Hurdle Hop', 'plyometric', 'foot_ankle_calf',
   '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
   ARRAY['calves','quads']::muscle[],
   ARRAY['glutes','abs']::muscle[],
   'hurdles', false, 'low', true, 'low', 'free', true, false,
   ARRAY['power_plyometric']::text[],
   '{"cns_cost":"high","impact":"high","emphasis":"reactive-strength"}'::jsonb),

  (NULL, 'skater-jump', 'Skater Jump', 'plyometric', 'knee',
   '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
   ARRAY['glutes','quads']::muscle[],
   ARRAY['abs','calves','abductors']::muscle[],
   'bodyweight', false, 'low', true, 'low', 'free', false, false,
   ARRAY['power_plyometric']::text[],
   '{"cns_cost":"high","impact":"high","emphasis":"frontal-plane-power"}'::jsonb),

  (NULL, 'split-squat-jump', 'Split Squat Jump', 'plyometric', 'knee',
   '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
   ARRAY['quads','glutes']::muscle[],
   ARRAY['calves','abs','hamstrings']::muscle[],
   'bodyweight', false, 'low', true, 'low', 'free', false, false,
   ARRAY['power_plyometric']::text[],
   '{"cns_cost":"high","impact":"high","emphasis":"single-leg-power"}'::jsonb),

  -- power_ballistic — loaded / explosive-intent plyos
  (NULL, 'jump-squat', 'Jump Squat', 'plyometric', 'knee',
   '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
   ARRAY['quads','glutes']::muscle[],
   ARRAY['calves','abs','hamstrings']::muscle[],
   'barbell-or-bodyweight', true, 'low', true, 'high', 'free', true, false,
   ARRAY['power_ballistic']::text[],
   '{"cns_cost":"high","impact":"high","emphasis":"loaded-vertical-power"}'::jsonb),

  (NULL, 'banded-jump', 'Banded Jump', 'plyometric', 'knee',
   '["foot_ankle_calf","hamstring_posterior"]'::jsonb,
   ARRAY['quads','glutes']::muscle[],
   ARRAY['calves','abs','hamstrings']::muscle[],
   'band', false, 'low', true, 'low', 'free', true, false,
   ARRAY['power_ballistic']::text[],
   '{"cns_cost":"high","impact":"high","emphasis":"eccentric-overload"}'::jsonb),

  (NULL, 'medicine-ball-overhead-throw', 'Med Ball Overhead Throw', 'plyometric', 'hamstring_posterior',
   '["lumbar_trunk","shoulder_scapular"]'::jsonb,
   ARRAY['glutes','hamstrings','lats']::muscle[],
   ARRAY['abs','front_delts','lower_back']::muscle[],
   'med-ball', false, 'low', false, 'low', 'free', true, false,
   ARRAY['power_ballistic']::text[],
   '{"cns_cost":"high","impact":"low","emphasis":"posterior-chain-throw"}'::jsonb)
ON CONFLICT ON CONSTRAINT movements_user_id_slug_unique DO NOTHING;

-- ─── Re-tag functional_roles for any pre-existing rows ────────────
-- Defensive: if the seed runner created these slugs before this migration
-- ran, the INSERT above is a no-op. Make sure their functional_roles end
-- up correct either way.
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_olympic')
WHERE slug IN ('split-jerk', 'dumbbell-snatch', 'kettlebell-snatch')
AND NOT ('power_olympic' = ANY(functional_roles));

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_plyometric')
WHERE slug IN ('hurdle-hop', 'skater-jump', 'split-squat-jump')
AND NOT ('power_plyometric' = ANY(functional_roles));

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_ballistic')
WHERE slug IN ('jump-squat', 'banded-jump', 'medicine-ball-overhead-throw', 'kb-clean-and-jerk')
AND NOT ('power_ballistic' = ANY(functional_roles));
