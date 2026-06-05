-- 0088_tag_accessory_roles_v2.sql
--
-- Reconcile movements.bulletproof_roles + functional_roles with the catalog-
-- accurate, deterministic derivation in seeds/derive-roles.ts.
--
-- WHY: 0019_tag_accessory_roles.sql tagged by hand-written slug lists that
-- drifted out of sync with the catalog, and seeds/run.ts upserts both role
-- columns from excluded.* on every reseed  so the durability floor (DC-O4:
-- heavy_isometric / hsr / plyometric / carry) and the archetype functional
-- requirements (single_leg / hip_stabilizer / ankle_foot / loaded_mobility /
-- anti_rotation) had ZERO coverage in prod. The picker silently degraded to
-- aesthetic-only accessory generation.
--
-- This fully RESETS the role arrays on global (seed) movements and re-applies
-- the derived tags, so prod matches what the seed now ships. Idempotent.
-- The reset also clears the stale 'quad_dominant_squat' role left on the
-- legacy 'back-squat' drift row.

UPDATE public.movements SET bulletproof_roles = '{}', functional_roles = '{}'
WHERE user_id IS NULL;

--  Bulletproof roles 
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'alfredson_eccentric')
WHERE user_id IS NULL AND slug IN (
  'eccentric-calf-alfredson', 'eccentric-chin-up', 'nordic-curl-eccentric', 'nordic-ham-curl'
);

UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'carry')
WHERE user_id IS NULL AND slug IN (
  'farmer-carry-db', 'farmer-carry-kb', 'farmer-carry-trap-bar', 'overhead-carry', 'suitcase-carry', 'zercher-carry'
);

UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'heavy_isometric')
WHERE user_id IS NULL AND slug IN (
  'copenhagen-plank', 'copenhagen-side-plank', 'dead-hang', 'hollow-body-hold', 'iso-calf-hold', 'iso-mid-thigh-pull', 'iso-ohp-pin-press', 'iso-split-squat', 'iso-wall-sit-heavy', 'plank', 'plate-pinch', 'rkc-plank', 'side-plank', 'spanish-squat', 'wall-sit'
);

UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'hsr')
WHERE user_id IS NULL AND slug IN (
  'hsr-calf-raise', 'hsr-front-squat', 'hsr-leg-press', 'hsr-rdl', 'tempo-back-squat'
);

UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'plyometric_high')
WHERE user_id IS NULL AND slug IN (
  'depth-jump', 'hurdle-hop', 'single-leg-bound'
);

UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'plyometric_low')
WHERE user_id IS NULL AND slug IN (
  'banded-jump', 'box-jump-high', 'box-jump-low', 'broad-jump', 'jump-squat', 'lateral-hop', 'pogo-hop', 'skater-jump', 'split-squat-jump', 'tuck-jump', 'vertical-jump'
);

--  Functional roles 
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'ankle_foot')
WHERE user_id IS NULL AND slug IN (
  'calf-raise-seated', 'calf-raise-standing', 'eccentric-calf-alfredson', 'hsr-calf-raise', 'iso-calf-hold', 'tibialis-raise'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'anti_extension')
WHERE user_id IS NULL AND slug IN (
  'ab-wheel-kneeling', 'ab-wheel-standing', 'dead-bug', 'dragon-flag', 'hanging-knee-raise', 'hanging-leg-raise', 'hollow-body-hold', 'plank', 'rkc-plank', 'side-plank', 'toes-to-bar'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'anti_rotation')
WHERE user_id IS NULL AND slug IN (
  'archer-pull-up', 'bird-dog', 'db-row-single-arm', 'kroc-row', 'landmine-press-half-kneeling', 'meadows-row', 'pallof-press', 'single-arm-pulldown', 'suitcase-carry'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'compound_assistance')
WHERE user_id IS NULL AND slug IN (
  'archer-pull-up', 'arnold-press', 'atg-split-squat', 'back-extension-45', 'bb-row-overhand', 'bb-row-underhand', 'belt-squat', 'bench-press-decline', 'bench-press-paused', 'block-pull-deadlift', 'box-squat', 'bulgarian-split-squat-bb', 'bulgarian-split-squat-db', 'cable-pull-through', 'cable-row-low', 'cable-row-seated', 'chest-supported-row-db', 'chest-supported-row-machine', 'chin-up', 'close-grip-bench', 'cossack-squat', 'db-bench-decline', 'db-bench-flat', 'db-bench-incline', 'db-row-single-arm', 'db-shoulder-press-seated', 'db-shoulder-press-standing', 'deficit-deadlift', 'deficit-rdl', 'dip-bench', 'dip-parallel', 'dip-ring', 'floor-press', 'glute-bridge-bb', 'goblet-squat', 'good-morning', 'hack-squat', 'hip-thrust-b-stance', 'hip-thrust-bb', 'hsr-front-squat', 'hsr-leg-press', 'inverted-row', 'kb-swing-american', 'kb-swing-russian', 'kroc-row', 'landmine-press-half-kneeling', 'landmine-press-standing', 'lat-pulldown-narrow', 'lat-pulldown-neutral', 'lat-pulldown-wide', 'leg-press-45', 'leg-press-vertical', 'machine-chest-press', 'meadows-row', 'paused-back-squat', 'paused-deadlift', 'pendlay-row', 'pendulum-squat', 'pistol-squat', 'pull-up-neutral', 'pull-up-overhand', 'rdl-bb', 'rdl-db', 'reverse-hyper', 'seal-row-bb', 'seal-row-db', 'seated-good-morning', 'single-arm-pulldown', 'single-leg-hip-thrust', 'single-leg-rdl', 'sissy-squat', 'smith-bench-press', 'smith-squat', 'spanish-squat', 'split-squat-bb', 'split-squat-db', 'ssb-squat', 'stiff-leg-deadlift', 't-bar-row', 'tempo-back-squat', 'wall-sit', 'weighted-pull-up', 'wide-grip-bench', 'z-press', 'zercher-squat'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'hip_stabilizer')
WHERE user_id IS NULL AND slug IN (
  'copenhagen-plank', 'copenhagen-side-plank', 'hip-abduction-band', 'hip-abduction-machine', 'hip-adduction-machine'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'loaded_mobility')
WHERE user_id IS NULL AND slug IN (
  'atg-split-squat', 'cossack-squat', 'cossack-squat-loaded', 'deficit-rdl', 'jefferson-curl'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_ballistic')
WHERE user_id IS NULL AND slug IN (
  'banded-jump', 'jump-squat', 'kb-clean-and-jerk', 'med-ball-chest-pass', 'med-ball-rotational-throw', 'med-ball-slam', 'medicine-ball-overhead-throw'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_olympic')
WHERE user_id IS NULL AND slug IN (
  'clean-pull', 'dumbbell-snatch', 'hang-clean', 'hang-power-clean', 'hang-snatch', 'kb-clean-and-jerk', 'kettlebell-snatch', 'power-clean', 'power-snatch', 'push-jerk', 'snatch-pull', 'split-jerk'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'power_plyometric')
WHERE user_id IS NULL AND slug IN (
  'banded-jump', 'box-jump-high', 'box-jump-low', 'broad-jump', 'depth-jump', 'hurdle-hop', 'jump-squat', 'lateral-hop', 'pogo-hop', 'single-leg-bound', 'skater-jump', 'split-squat-jump', 'tuck-jump', 'vertical-jump'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'single_leg')
WHERE user_id IS NULL AND slug IN (
  'atg-split-squat', 'bulgarian-split-squat-bb', 'bulgarian-split-squat-db', 'cossack-squat', 'cossack-squat-loaded', 'hip-thrust-b-stance', 'pistol-squat', 'single-leg-hip-thrust', 'single-leg-rdl', 'split-squat-bb', 'split-squat-db'
);

UPDATE public.movements SET functional_roles = array_append(functional_roles, 'velocity_cued')
WHERE user_id IS NULL AND slug IN (
  'banded-jump', 'jump-squat'
);

