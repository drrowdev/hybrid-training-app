-- Rollback for 0139_seed_lunges.
--
-- Removes the six lunge rows and their how-to content.
--
-- Fails fast rather than destroying data: `set_logs` and `session_movements`
-- reference `movements(id)` ON DELETE RESTRICT, but `training_maxes`,
-- `tm_suggestions` and `movement_instructions` CASCADE and `cardio_logs` is set
-- NULL. So if a lifter has logged a lunge, a bare DELETE would either error
-- halfway or quietly drop a training max or a pending TM suggestion. The guard
-- below raises with a clear message instead; clear the references first if you
-- really mean to remove these.

DO $$
DECLARE
  lunge_ids uuid[];
  blocking  int;
BEGIN
  SELECT array_agg(id) INTO lunge_ids
    FROM public.movements
   WHERE user_id IS NULL
     AND slug IN (
       'forward-lunge', 'forward-lunge-db', 'forward-lunge-bb',
       'reverse-lunge', 'reverse-lunge-db', 'reverse-lunge-bb'
     );

  IF lunge_ids IS NULL THEN
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM public.set_logs WHERE movement_id = ANY(lunge_ids))
       + (SELECT count(*) FROM public.session_movements WHERE movement_id = ANY(lunge_ids))
       + (SELECT count(*) FROM public.training_maxes WHERE movement_id = ANY(lunge_ids))
       + (SELECT count(*) FROM public.tm_suggestions WHERE movement_id = ANY(lunge_ids))
       + (SELECT count(*) FROM public.tm_history WHERE movement_id = ANY(lunge_ids))
       + (SELECT count(*) FROM public.cardio_logs WHERE movement_id = ANY(lunge_ids))
    INTO blocking;

  IF blocking > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 0139: % user reference(s) to the lunges. Remove or repoint them first.',
      blocking;
  END IF;

  DELETE FROM public.movements WHERE id = ANY(lunge_ids);
END $$;
