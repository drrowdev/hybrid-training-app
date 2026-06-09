-- 0100_catalog_tagging_audit.sql
--
-- Catalog muscle/region tagging audit (follow-up to 0099). The limitation
-- safety filter (`loadsBlockedMuscle` / `loadsBlockedRegion`) is only as good as
-- the muscle + region tags, so a rule-based audit was run across every injury
-- site. Fixes below; all are SECONDARY tags except the back-squat orphan, so
-- there is NO prescription change for non-injured users (selection keys off
-- PRIMARY muscles/roles; weekly-volume tracking is primary-only, DC-T1).
-- Idempotent (guarded appends). Global (seed) movements only.

-- (0) back-squat orphan — a prod row (NOT in the seed) with EMPTY muscle tags,
--     so it slipped past every muscle-injury flag. Give it the standard back-squat profile.
UPDATE public.movements
SET primary_muscles = ARRAY['quads','glutes']::muscle[],
    secondary_muscles = ARRAY['hamstrings','lower_back','adductors']::muscle[],
    secondary_regions = '["hamstring_posterior","lumbar_trunk","foot_ankle_calf"]'::jsonb
WHERE user_id IS NULL AND slug = 'back-squat'
  AND COALESCE(array_length(primary_muscles, 1), 0) = 0;

-- (1) lower_back muscle on UNSUPPORTED spinal loaders (bent-over rows, standing
--     overhead presses, RDL/hinge variants, front-loaded HSR squat, split jerk).
--     Supported rows (seal/kroc), chest-supported work and hip thrusts are
--     deliberately EXCLUDED — they are spine-sparing.
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'lower_back'::muscle)
WHERE user_id IS NULL
  AND slug IN (
    'bb-row-overhand','bb-row-underhand','pendlay-row','meadows-row','t-bar-row',
    'ohp-standing','push-press','db-shoulder-press-standing','landmine-press-standing','z-press',
    'hsr-rdl','rdl-db','single-leg-rdl','kb-swing-american','hsr-front-squat','split-jerk'
  )
  AND NOT ('lower_back' = ANY(primary_muscles))
  AND NOT ('lower_back' = ANY(secondary_muscles));

-- (2) lumbar_trunk REGION on the same unsupported spinal loaders.
UPDATE public.movements
SET secondary_regions = secondary_regions || '["lumbar_trunk"]'::jsonb
WHERE user_id IS NULL
  AND slug IN (
    'bb-row-overhand','bb-row-underhand','pendlay-row','meadows-row','t-bar-row',
    'ohp-standing','push-press','db-shoulder-press-standing','landmine-press-standing','z-press',
    'hsr-rdl','rdl-db','single-leg-rdl','kb-swing-american','hsr-front-squat','split-jerk'
  )
  AND primary_region <> 'lumbar_trunk'
  AND NOT (secondary_regions @> '["lumbar_trunk"]'::jsonb);

-- (3) biceps on overhand/neutral bent-over + cable rows (elbow flexion in the pull).
--     Straight-arm pulldown / scapular pull-up correctly stay biceps-free.
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'biceps'::muscle)
WHERE user_id IS NULL
  AND slug IN ('bb-row-overhand','pendlay-row','meadows-row','t-bar-row','cable-row-low')
  AND NOT ('biceps' = ANY(primary_muscles))
  AND NOT ('biceps' = ANY(secondary_muscles));

-- (4) forearms on grip-heavy movements (Olympic lifts hold/pull a loaded bar;
--     heavy shrugs; bar hangs).
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'forearms'::muscle)
WHERE user_id IS NULL
  AND slug IN (
    'clean-pull','dumbbell-snatch','hang-clean','hang-power-clean','hang-snatch',
    'kb-clean-and-jerk','kettlebell-snatch','power-clean','power-snatch','snatch-pull',
    'push-jerk','split-jerk','shrug-trap-bar','kelso-shrug','eccentric-chin-up','scapular-pull-up'
  )
  AND NOT ('forearms' = ANY(primary_muscles))
  AND NOT ('forearms' = ANY(secondary_muscles));

-- (5) glutes on movements that extend the hip but lost the tag.
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'glutes'::muscle)
WHERE user_id IS NULL
  AND slug IN ('iso-split-squat','hsr-front-squat','seated-good-morning')
  AND NOT ('glutes' = ANY(primary_muscles))
  AND NOT ('glutes' = ANY(secondary_muscles));

-- (6) hamstrings on iso-split-squat (matches its squat siblings + the seed).
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'hamstrings'::muscle)
WHERE user_id IS NULL AND slug = 'iso-split-squat'
  AND NOT ('hamstrings' = ANY(primary_muscles))
  AND NOT ('hamstrings' = ANY(secondary_muscles));

-- (7) knee REGION on the loaded Cossack squat (its bodyweight sibling has it).
UPDATE public.movements
SET secondary_regions = secondary_regions || '["knee"]'::jsonb
WHERE user_id IS NULL AND slug = 'cossack-squat-loaded'
  AND primary_region <> 'knee'
  AND NOT (secondary_regions @> '["knee"]'::jsonb);

-- (8) triceps on the wide-grip bench (every other bench variant tags it).
UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'triceps'::muscle)
WHERE user_id IS NULL AND slug = 'wide-grip-bench'
  AND NOT ('triceps' = ANY(primary_muscles))
  AND NOT ('triceps' = ANY(secondary_muscles));
