-- Rollback for 0142_seed_ghd_back_extension.
--
-- Removes the GHD back extension and its how-to content.
--
-- Fails fast rather than destroying data. `set_logs` and `session_movements`
-- reference `movements(id)` ON DELETE RESTRICT, but `training_maxes`,
-- `tm_suggestions` and `movement_instructions` CASCADE and `cardio_logs` is set
-- NULL — so a bare DELETE would either error halfway or quietly drop a training
-- max or a pending TM suggestion. The guard below raises instead; clear the
-- references first if you really mean to remove it.

DO $$
DECLARE
  ghd_id   uuid;
  blocking int;
BEGIN
  SELECT id INTO ghd_id
    FROM public.movements
   WHERE user_id IS NULL AND slug = 'back-extension-ghd';

  IF ghd_id IS NULL THEN
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM public.set_logs WHERE movement_id = ghd_id)
       + (SELECT count(*) FROM public.session_movements WHERE movement_id = ghd_id)
       + (SELECT count(*) FROM public.training_maxes WHERE movement_id = ghd_id)
       + (SELECT count(*) FROM public.tm_suggestions WHERE movement_id = ghd_id)
       + (SELECT count(*) FROM public.tm_history WHERE movement_id = ghd_id)
       + (SELECT count(*) FROM public.cardio_logs WHERE movement_id = ghd_id)
    INTO blocking;

  IF blocking > 0 THEN
    RAISE EXCEPTION
      'Refusing to roll back 0142: % user reference(s) to the GHD back extension. Remove or repoint them first.',
      blocking;
  END IF;

  DELETE FROM public.movements WHERE id = ghd_id;
END $$;
