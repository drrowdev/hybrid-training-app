-- Rollback for 0138_merge_duplicate_copenhagen.
--
-- Re-creates the `copenhagen-side-plank` catalog row and its how-to content as
-- they were seeded by the `tendon(...)` helper before the merge.
--
-- NOT a true undo. 0138 MOVED history — logged sets, session movements,
-- training maxes, TM history, limitation adjustments and prescription JSONB —
-- onto `copenhagen-plank`, and nothing records which of those originally
-- belonged to the duplicate. Re-creating the row therefore gives back the
-- library entry, not the attribution. Where 0138 deleted a losing row on a
-- unique-key collision (a second training max, a pending TM suggestion, a
-- duplicate session movement), that row is gone for good.
--
-- Run this only to restore the catalog entry. If you need the history split
-- back out, restore from a backup taken before 0138.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES (
  NULL, 'copenhagen-side-plank', 'Copenhagen Side Plank', 'tendon', 'adductor_groin',
  '[]'::jsonb,
  '{adductors,obliques}'::muscle[],
  '{}'::muscle[],
  'bench', false, 'low',
  true, '{heavy_isometric}'::text[], '{hip_stabilizer}'::text[], false,
  'low', 'free', true, false,
  0, 4,
  '{"protocol":"isometric","emphasis":"adductor-prehab"}'::jsonb
)
ON CONFLICT (user_id, slug) DO NOTHING;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  id,
  'Side plank with the top leg on a bench — a strong adductor isometric for groin resilience.',
  'Lie on your side, top foot/shin on a bench, elbow under the shoulder.',
  '["Lift the hips into a straight line, supported by the top leg.","Squeeze the bench with the top leg.","Hold for the prescribed time, then switch sides."]'::jsonb,
  '["Body in one straight line.","Pull the top leg into the bench."]'::jsonb,
  '[]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'copenhagen-side-plank'
ON CONFLICT (movement_id) DO NOTHING;
