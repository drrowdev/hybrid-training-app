-- 0019_tag_accessory_roles.sql
-- One-shot data migration: tag the seeded movement catalog with
-- bulletproof_roles + functional_roles so the dynamic picker can match
-- against the role taxonomy declared in lib/planner/accessory-roles.ts.
--
-- This is data-side tagging, not behaviour. The picker reads these tags;
-- archetypes never read slugs. Adding new movements later is a matter
-- of seeding them with the right tag arrays — no code changes needed.

-- ─── Bulletproof: heavy_isometric ─────────────────────────────────
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'heavy_isometric')
WHERE slug IN (
  'wall-sit', 'spanish-squat-hold', 'split-squat-iso',
  'hamstring-bridge-iso', 'calf-iso-hold', 'glute-bridge-iso',
  'copenhagen-plank', 'side-plank', 'plank', 'rkc-plank',
  'l-sit', 'hollow-hold'
);

-- ─── Bulletproof: hsr (Heavy Slow Resistance, Kongsgaard 2009) ────
-- Tempo / 3-second-eccentric variants that double as tendon adaptation.
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'hsr')
WHERE slug IN (
  'tempo-back-squat', 'tempo-bench', 'tempo-rdl', 'tempo-calf-raise',
  'tempo-front-squat', 'tempo-bulgarian-split-squat',
  'paused-back-squat', 'paused-bench', 'paused-deadlift',
  'rdl-bb', 'rdl-db', 'calf-raise-standing-3s', 'calf-raise-seated-3s',
  'single-leg-press-tempo'
)
OR (slug LIKE 'tempo-%' AND is_compound = true);

-- ─── Bulletproof: plyometric_low ──────────────────────────────────
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'plyometric_low')
WHERE slug IN (
  'pogo-hops', 'ankle-hops', 'line-hops', 'low-box-step-off',
  'jump-rope', 'tuck-jump-low', 'broad-jump-low'
);

-- ─── Bulletproof: plyometric_high ─────────────────────────────────
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'plyometric_high')
WHERE slug IN (
  'box-jump', 'depth-jump', 'broad-jump', 'bounds', 'hurdle-hop',
  'single-leg-bound', 'lateral-bound'
);

-- ─── Bulletproof: carry ───────────────────────────────────────────
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'carry')
WHERE slug IN (
  'farmer-carry', 'farmer-carry-db', 'farmer-carry-kb', 'farmer-carry-trap-bar',
  'suitcase-carry', 'suitcase-carry-db', 'suitcase-carry-kb',
  'overhead-carry', 'overhead-carry-kb', 'front-rack-carry',
  'zercher-carry', 'yoke-walk', 'sandbag-carry', 'waiter-walk',
  'mixed-carry'
);

-- ─── Bulletproof: alfredson_eccentric (symptomatic) ───────────────
UPDATE public.movements SET bulletproof_roles = array_append(bulletproof_roles, 'alfredson_eccentric')
WHERE slug IN (
  'alfredson-calf-eccentric', 'single-leg-eccentric-squat',
  'eccentric-wrist-curl', 'eccentric-calf-raise'
);

-- ─── Functional: single_leg ───────────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'single_leg')
WHERE bilateral = false
  AND pattern IN ('squat', 'hinge', 'press', 'pull')
  AND slug NOT LIKE '%pistol-squat-assisted%';

-- Catch a few that are bilateral = false but might miss the pattern filter
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'single_leg')
WHERE slug IN (
  'step-up', 'step-up-bb', 'step-up-db', 'pistol-squat', 'pistol-squat-box',
  'skater-squat', 'single-leg-rdl', 'single-leg-rdl-db',
  'single-leg-press', 'reverse-lunge', 'walking-lunge', 'forward-lunge',
  'curtsy-lunge', 'split-squat-bb', 'split-squat-db', 'atg-split-squat',
  'bulgarian-split-squat-db', 'bulgarian-split-squat-bb'
) AND NOT ('single_leg' = ANY(functional_roles));

-- ─── Functional: anti_rotation ────────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'anti_rotation')
WHERE slug IN (
  'pallof-press', 'pallof-press-band', 'pallof-step-out',
  'half-kneeling-chop', 'half-kneeling-lift', 'tall-kneeling-pallof',
  'renegade-row', 'single-arm-overhead-press', 'single-arm-bench',
  'bird-dog', 'turkish-get-up', 'landmine-rotation',
  'suitcase-carry', 'suitcase-carry-db', 'suitcase-carry-kb',
  'waiter-walk'
) AND NOT ('anti_rotation' = ANY(functional_roles));

-- ─── Functional: anti_extension ───────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'anti_extension')
WHERE slug IN (
  'dead-bug', 'ab-wheel', 'ab-wheel-kneeling', 'hollow-hold',
  'hanging-leg-raise', 'hanging-knee-raise', 'plank', 'rkc-plank',
  'stir-the-pot', 'l-sit', 'dragon-flag'
);

-- ─── Functional: loaded_mobility ──────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'loaded_mobility')
WHERE slug IN (
  'cossack-squat', 'jefferson-curl', 'atg-split-squat',
  'deep-goblet-squat', 'deficit-rdl', 'kb-windmill',
  'overhead-squat', 'sots-press', 'jefferson-curl-light'
);

-- ─── Functional: compound_assistance ──────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'compound_assistance')
WHERE is_compound = true
  AND slug NOT IN (
    -- exclude the main lift variants themselves; assistance variants only
    'back-squat-high-bar', 'back-squat-low-bar', 'front-squat',
    'bench-press-flat', 'bench-press-incline', 'bench-press-paused',
    'conventional-deadlift', 'sumo-deadlift',
    'ohp-standing', 'push-press'
  );

-- ─── Functional: velocity_cued ────────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'velocity_cued')
WHERE slug LIKE 'speed-%' OR slug LIKE '%-jump-%' OR slug IN (
  'jump-squat', 'banded-bench', 'banded-squat', 'banded-deadlift',
  'speed-squat', 'speed-bench', 'speed-pull'
);

-- ─── Functional: hip_stabilizer ───────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'hip_stabilizer')
WHERE slug IN (
  'hip-airplane', 'clamshell', 'clamshell-band', 'side-lying-clamshell',
  'banded-crab-walk', 'monster-walk', 'single-leg-glute-bridge',
  'copenhagen-plank', 'side-plank-leg-raise', 'fire-hydrant'
);

-- ─── Functional: ankle_foot ───────────────────────────────────────
UPDATE public.movements SET functional_roles = array_append(functional_roles, 'ankle_foot')
WHERE slug IN (
  'tibialis-raise', 'tibialis-raise-banded', 'short-foot-drill',
  'ankle-dorsiflexion-hold', 'toe-yoga', 'single-leg-calf-raise',
  'calf-raise-standing', 'calf-raise-seated'
);

-- ─── Eccentric load score (1-5, higher = more eccentric stress) ───
UPDATE public.movements SET eccentric_load_score = 5
WHERE high_strain_tendon = true OR slug IN ('nordic-curl', 'depth-jump', 'eccentric-calf-raise');

UPDATE public.movements SET eccentric_load_score = 4
WHERE eccentric_load_score IS NULL AND slug IN (
  'tempo-back-squat', 'tempo-rdl', 'tempo-bench', 'paused-back-squat',
  'rdl-bb', 'rdl-db', 'romanian-deadlift'
);

UPDATE public.movements SET eccentric_load_score = 3
WHERE eccentric_load_score IS NULL AND is_compound = true;

UPDATE public.movements SET eccentric_load_score = 2
WHERE eccentric_load_score IS NULL AND is_supported = true;

UPDATE public.movements SET eccentric_load_score = 1
WHERE eccentric_load_score IS NULL;

-- ─── Stim-to-fatigue score (1-5, higher = better signal per fatigue) ───
-- Machine isolation and cable work get the bonus; high-eccentric / compound
-- variants are rated lower because they cost more recovery.
UPDATE public.movements SET stim_to_fatigue_score = 5
WHERE is_supported = true AND is_compound = false;

UPDATE public.movements SET stim_to_fatigue_score = 4
WHERE stim_to_fatigue_score IS NULL AND is_supported = true;

UPDATE public.movements SET stim_to_fatigue_score = 3
WHERE stim_to_fatigue_score IS NULL AND eccentric_load_score IS NOT NULL AND eccentric_load_score <= 3;

UPDATE public.movements SET stim_to_fatigue_score = 2
WHERE stim_to_fatigue_score IS NULL;
