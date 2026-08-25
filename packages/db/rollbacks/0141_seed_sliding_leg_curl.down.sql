-- Rollback for 0141_seed_sliding_leg_curl.
--
-- Removes the sliding leg curl and its how-to content.
--
-- Fails fast rather than destroying data. `set_logs` and `session_movements`
-- reference `movements(id)` ON DELETE RESTRICT, but `training_maxes`,
-- `tm_suggestions` and `movement_instructions` CASCADE and `cardio_logs` is set
-- NULL — so a bare DELETE would either error halfway or quietly drop a training
-- max or a pending TM suggestion. The guard below raises instead; clear the
-- references first if you really mean to remove it.

DO $$
DECLARE
  curl_id  uuid;
  blocking int;
BEGIN
  SELECT id INTO curl_id
    FROM public.movements
   WHERE user_id IS NULL AND slug = 'sliding-leg-curl';

  IF curl_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM public.set_logs WHERE movement_id = curl_id)
       + (SELECT count(*) FROM public.session_movements WHERE movement_id = curl_id)
       + (SELECT count(*) FROM public.training_maxes WHERE movement_id = curl_id)
       + (SELECT count(*) FROM public.tm_suggestions WHERE movement_id = curl_id)
       + (SELECT count(*) FROM public.tm_history WHERE movement_id = curl_id)
       + (SELECT count(*) FROM public.cardio_logs WHERE movement_id = curl_id)
    INTO blocking;

  IF blocking > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 0141: % user reference(s) to the sliding leg curl. Remove or repoint them first.',
      blocking;
  END IF;

  DELETE FROM public.movements WHERE id = curl_id;
END $$;
