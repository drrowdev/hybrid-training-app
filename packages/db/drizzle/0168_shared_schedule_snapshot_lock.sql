-- The schedule snapshot is a read, but it took the same exclusive per-user lock as every
-- write, so page loads queued behind each other and behind saves until the API gateway
-- gave up. Readers now share the lock (writers still exclude them), and both the
-- snapshot and the prescription save stop waiting after five seconds instead of hanging.
--
-- Only the lock statement of each function is rewritten, and only when it appears exactly
-- once; owner, ACL and settings are asserted unchanged.
DO $migration$
DECLARE
  entry record; routine regprocedure; definition text; revised text; attributes jsonb;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.training_schedule_snapshot()',
      $old$PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));$old$,
      $new$DECLARE previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
  BEGIN
    PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('program-deploy:' || u::text, 0));
    PERFORM pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
  END;$new$),
    ('public.save_prescription_if_current(text,uuid,text,jsonb,boolean)',
      $old$PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));$old$,
      $new$DECLARE previous_lock_timeout text := pg_catalog.current_setting('lock_timeout');
  BEGIN
    PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
    PERFORM pg_catalog.set_config('lock_timeout', previous_lock_timeout, true);
  END;$new$)
  ) AS target(signature, old_text, new_text) LOOP
    routine := to_regprocedure(entry.signature);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'Lock change refused: % is missing.', entry.signature;
    END IF;
    SELECT pg_get_functiondef(oid), jsonb_build_array(proowner, prosecdef, proconfig, proacl::text)
      INTO definition, attributes FROM pg_proc WHERE oid = routine;
    IF (length(definition) - length(replace(definition, entry.old_text, ''))) / length(entry.old_text) <> 1 THEN
      RAISE EXCEPTION 'Lock change refused: % has an unexpected lock statement.', entry.signature;
    END IF;
    revised := replace(definition, entry.old_text, entry.new_text);
    EXECUTE revised;
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM attributes THEN
      RAISE EXCEPTION 'Lock change refused: % attributes changed.', entry.signature;
    END IF;
  END LOOP;
END
$migration$;
