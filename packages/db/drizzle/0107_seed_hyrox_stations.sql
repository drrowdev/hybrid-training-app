-- 0107_seed_hyrox_stations.sql
--
-- Seed the HYROX functional-station movements the catalogue lacked, so the HYROX
-- program (ADR 0050) can attribute muscle/region load when a logged session is
-- materialised into actual log rows (ADR 0050 step 7 — freshness/interference
-- read ACTUALS, never planned). These are DISPLAY + completion-time attribution
-- movements; HYROX sessions log at the session level (time + RPE + confirm
-- weights), so they are never logged per-set.
--
-- Scope — only the four stations with NO existing catalogue equivalent:
--   * sled-pull          (hand-over-hand rope pull; distinct from sled-push /
--                         sled-drag, which exist — a posterior-chain PULL, not a push)
--   * burpee-broad-jump  (the combined station movement; plain broad-jump exists
--                         but not the burpee+jump conditioning movement)
--   * sandbag-lunge      (loaded walking lunge; no sandbag movement existed)
--   * wall-ball          (squat-to-target throw; no wall-ball/med-ball-shot existed)
-- The other five stations already resolve: SkiErg (ski-erg), Sled Push
-- (sled-push-*), Row (erg-* rowing), Farmers Carry (farmer-carry-*), and running
-- (run-*). The engine references those existing slugs.
--
-- Muscle/region tags follow the seed conventions of the comparable helpers in
-- packages/db/seeds/movements-part2/3.ts (sled / carry / plyo). Roles are left
-- empty: these are race stations, not accessory-picker candidates, so they must
-- NOT surface in the accessory rotation. Idempotent (ON CONFLICT upsert).

INSERT INTO public.movements (user_id, slug, display_name, pattern, primary_region, secondary_regions, primary_muscles, secondary_muscles, equipment, is_compound, interference_cost, high_strain_tendon, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, axial_load, stability, bilateral, body_weight_loaded, experience_min, experience_max, metadata) VALUES
  (NULL, 'sled-pull', 'Sled Pull', 'cardio', 'lumbar_trunk', '["shoulder_scapular","hamstring_posterior"]'::jsonb, '{lats,mid_back,biceps}'::muscle[], '{forearms,traps,rear_delts,glutes,hamstrings}'::muscle[], 'sled', true, 'low_moderate', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"modality":"sled","station":"hyrox","emphasis":"posterior-chain-pull"}'::jsonb),
  (NULL, 'burpee-broad-jump', 'Burpee Broad Jump', 'cardio', 'knee', '["foot_ankle_calf","shoulder_scapular","lumbar_trunk"]'::jsonb, '{quads,glutes,chest}'::muscle[], '{triceps,front_delts,calves,abs,hamstrings}'::muscle[], 'bodyweight', true, 'moderate', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, true, 0, 4, '{"modality":"calisthenics","station":"hyrox","impact":"high","emphasis":"full-body-conditioning"}'::jsonb),
  (NULL, 'sandbag-lunge', 'Sandbag Lunge', 'compound', 'knee', '["hamstring_posterior","adductor_groin","lumbar_trunk"]'::jsonb, '{quads,glutes}'::muscle[], '{hamstrings,adductors,calves,abs}'::muscle[], 'sandbag', true, 'moderate', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'moderate', 'free', false, false, 0, 4, '{"modality":"loaded-lunge","station":"hyrox","emphasis":"quad-endurance-loaded"}'::jsonb),
  (NULL, 'wall-ball', 'Wall Ball', 'compound', 'knee', '["shoulder_scapular","lumbar_trunk"]'::jsonb, '{quads,glutes,front_delts}'::muscle[], '{triceps,upper_chest,abs,calves}'::muscle[], 'wall-ball', true, 'moderate', false, '{}'::text[], '{}'::text[], false, NULL, NULL, 'low', 'free', true, false, 0, 4, '{"modality":"ballistic","station":"hyrox","emphasis":"squat-throw-power-endurance","target_height_m_men":3.0,"target_height_m_women":2.7}'::jsonb)
ON CONFLICT (user_id, slug) DO UPDATE SET
  display_name = excluded.display_name,
  pattern = excluded.pattern,
  primary_region = excluded.primary_region,
  secondary_regions = excluded.secondary_regions,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  equipment = excluded.equipment,
  is_compound = excluded.is_compound,
  interference_cost = excluded.interference_cost,
  high_strain_tendon = excluded.high_strain_tendon,
  axial_load = excluded.axial_load,
  stability = excluded.stability,
  bilateral = excluded.bilateral,
  body_weight_loaded = excluded.body_weight_loaded,
  experience_min = excluded.experience_min,
  experience_max = excluded.experience_max,
  metadata = excluded.metadata;
