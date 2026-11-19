-- Manual rollback for 0168. Run in a maintenance window.
-- Restores the exclusive lock in the schedule snapshot and drops the five-second wait
-- from the snapshot and the prescription save.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $rollback$
DECLARE
  entry record; routine regprocedure; definition text; revised text; attributes jsonb;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.training_schedule_snapshot()',
      $new$DECLARE previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
  BEGIN
    PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('program-deploy:' || u::text, 0));
    PERFORM pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
  END;$new$,
      $old$PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));$old$),
    ('public.save_prescription_if_current(text,uuid,text,jsonb,boolean)',
      $new$DECLARE previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
  BEGIN
    PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
    PERFORM pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
  END;$new$,
      $old$PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));$old$)
  ) AS target(signature, current_text, original_text) LOOP
    routine := to_regprocedure(entry.signature);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'Rollback refused: % is missing.', entry.signature;
    END IF;
    SELECT pg_get_functiondef(oid), jsonb_build_array(proowner, prosecdef, proconfig, proacl::text)
      INTO definition, attributes FROM pg_proc WHERE oid = routine;
    IF (length(definition) - length(replace(definition, entry.current_text, ''))) / length(entry.current_text) <> 1 THEN
      RAISE EXCEPTION 'Rollback refused: % does not carry the 0168 lock statement.', entry.signature;
    END IF;
    revised := replace(definition, entry.current_text, entry.original_text);
    EXECUTE revised;
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM attributes THEN
      RAISE EXCEPTION 'Rollback refused: % attributes changed.', entry.signature;
    END IF;
  END LOOP;
END
$rollback$;
COMMIT;
