-- 0099_tag_adductor_loaders.sql
--
-- Safety-data fix. Several squat / split-squat / leg-press variants load the
-- adductors (the lead-leg adductor magnus is a hip extensor; deep split and
-- front-rack positions stress the groin) but were MISSING the `adductors`
-- secondary-muscle tag their siblings carry:
--   - iso-split-squat had none, while split-squat-bb/db + bulgarian + ATG do
--   - front-squat / zercher-squat override secondaryMuscles and lost the
--     squat-helper default that includes adductors
--   - the HSR/iso tendon squat+leg-press variants never had it
--
-- The limitation safety filter (`loadsBlockedMuscle`) keys off muscle tags, so
-- an adductor-injury flag was waving these movements through — and even
-- recommending Heavy Isometric Split Squat as a "safe" swap for Spanish Squat.
-- Tagging them makes the filter (both block generation and the mid-block
-- limitation response) correctly avoid the groin.
--
-- Secondary-muscle only ⇒ NO prescription change for non-injured users:
-- candidate selection keys off PRIMARY muscles / roles, and weekly-volume
-- tracking is primary-only (DC-T1). Idempotent (guarded by NOT ANY).

UPDATE public.movements
SET secondary_muscles = array_append(secondary_muscles, 'adductors'::muscle)
WHERE user_id IS NULL
  AND slug IN (
    'iso-split-squat',
    'iso-wall-sit-heavy',
    'hsr-leg-press',
    'hsr-front-squat',
    'front-squat',
    'zercher-squat'
  )
  AND NOT ('adductors' = ANY(primary_muscles))
  AND NOT ('adductors' = ANY(secondary_muscles));
