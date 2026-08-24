-- Rollback for 0140_seed_lunge_variants.
--
-- Removes the walking lunge, step-up, curtsy lunge and lateral lunge rows and
-- their how-to content.
--
-- Fails fast rather than destroying data. `set_logs` and `session_movements`
-- reference `movements(id)` ON DELETE RESTRICT, but `training_maxes`,
-- `tm_suggestions` and `movement_instructions` CASCADE and `cardio_logs` is set
-- NULL — so a bare DELETE would either error halfway or quietly drop a training
-- max or a pending TM suggestion. The guard below raises instead; clear the
-- references first if you really mean to remove these.

DO $$
DECLARE
  variant_ids uuid[];
  blocking    int;
BEGIN
  SELECT array_agg(id) INTO variant_ids
    FROM public.movements
   WHERE user_id IS NULL
     AND slug IN (
       'walking-lunge', 'walking-lunge-db', 'walking-lunge-bb',
       'step-up', 'step-up-db', 'step-up-bb',
       'curtsy-lunge', 'curtsy-lunge-db',
       'lateral-lunge', 'lateral-lunge-db'
     );

  IF variant_ids IS NULL THEN
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM public.set_logs WHERE movement_id = ANY(variant_ids))
       + (SELECT count(*) FROM public.session_movements WHERE movement_id = ANY(variant_ids))
       + (SELECT count(*) FROM public.training_maxes WHERE movement_id = ANY(variant_ids))
       + (SELECT count(*) FROM public.tm_suggestions WHERE movement_id = ANY(variant_ids))
       + (SELECT count(*) FROM public.tm_history WHERE movement_id = ANY(variant_ids))
       + (SELECT count(*) FROM public.cardio_logs WHERE movement_id = ANY(variant_ids))
    INTO blocking;

  IF blocking > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 0140: % user reference(s) to the lunge variants. Remove or repoint them first.',
      blocking;
  END IF;

  DELETE FROM public.movements WHERE id = ANY(variant_ids);
END $$;
