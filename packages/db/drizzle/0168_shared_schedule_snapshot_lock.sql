-- The schedule snapshot is a read, but it takes the same exclusive per-user lock as every
-- write, so page loads queue behind each other and behind saves until the API gateway
-- gives up. This adds a read-only twin that takes the lock in shared mode (writers still
-- exclude it) and stops waiting after five seconds.
--
-- The twin is copied from the snapshot as it stands, so both return the same revision.
-- Earlier migrations pin the snapshot's body and their rollbacks restore it exactly, so
-- the snapshot itself is left untouched.
DO $migration$
DECLARE
  routine regprocedure := to_regprocedure('public.training_schedule_snapshot()');
  definition text; revised text;
  old_lock text := $old$PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));$old$;
  new_lock text := $new$DECLARE previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
  BEGIN
    PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('program-deploy:' || u::text, 0));
    PERFORM pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
  END;$new$;
  old_name text := 'public.training_schedule_snapshot()';
BEGIN
  IF routine IS NULL THEN
    RAISE EXCEPTION 'Shared schedule read refused: training_schedule_snapshot is missing.';
  END IF;
  definition := pg_get_functiondef(routine);
  IF (length(definition) - length(replace(definition, old_lock, ''))) / length(old_lock) <> 1
    OR (length(definition) - length(replace(definition, old_name, ''))) / length(old_name) <> 1 THEN
    RAISE EXCEPTION 'Shared schedule read refused: the snapshot has an unexpected lock statement or name.';
  END IF;
  revised := replace(replace(definition, old_lock, new_lock), old_name, 'public.training_schedule_read()');
  EXECUTE revised;
END
$migration$;
REVOKE ALL ON FUNCTION public.training_schedule_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_schedule_read() TO authenticated;
