-- Rollback for 0145_seed_single_leg_rdl_variants.
--
-- Restores the legacy dumbbell-or-kettlebell movement and removes the new
-- barbell variant. The existing movement keeps its UUID throughout.
--
-- The barbell delete fails fast rather than destroying user data. Clear or
-- repoint every listed reference first if the movement has already been used.

DO $$
DECLARE
  bb_id    uuid;
  blocking int;
BEGIN
  SELECT id INTO bb_id
    FROM public.movements
   WHERE user_id IS NULL AND slug = 'single-leg-rdl-bb';

  IF bb_id IS NOT NULL THEN
    SELECT (SELECT count(*) FROM public.set_logs WHERE movement_id = bb_id)
         + (SELECT count(*) FROM public.session_movements WHERE movement_id = bb_id)
         + (SELECT count(*) FROM public.training_maxes WHERE movement_id = bb_id)
         + (SELECT count(*) FROM public.tm_suggestions WHERE movement_id = bb_id)
         + (SELECT count(*) FROM public.tm_history WHERE movement_id = bb_id)
         + (SELECT count(*) FROM public.cardio_logs WHERE movement_id = bb_id)
      INTO blocking;

    IF blocking > 0 THEN
      RAISE EXCEPTION
        'Refusing to roll back 0145: % user reference(s) to the barbell single-leg Romanian deadlift. Remove or repoint them first.',
        blocking;
    END IF;

    DELETE FROM public.movements WHERE id = bb_id;
  END IF;

  UPDATE public.movements
     SET display_name = 'Single-Leg RDL',
         equipment = 'dumbbell-or-kb',
         secondary_muscles = '{abductors,lower_back}'::muscle[]
   WHERE user_id IS NULL
     AND slug = 'single-leg-rdl';

  UPDATE public.movement_instructions
     SET summary = 'Single-leg hinge for the hamstrings, glutes and balance.',
         setup = 'Hold a weight in one or both hands, stand on one leg with a soft knee.',
         steps = '["Hinge at the hip, letting the free leg float back as a counterweight.","Lower until the torso and back leg are near parallel.","Squeeze the glute to return upright."]'::jsonb,
         cues = '["Hips stay square to the floor.","Move slowly — control the balance."]'::jsonb,
         common_mistakes = '["Letting the hip of the free leg rotate open."]'::jsonb,
         updated_at = now()
   WHERE movement_id = (
     SELECT id
       FROM public.movements
      WHERE user_id IS NULL AND slug = 'single-leg-rdl'
   );
END $$;
