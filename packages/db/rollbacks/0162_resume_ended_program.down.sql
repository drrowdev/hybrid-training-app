-- Roll back the app first. Never remove or rewrite a user's resume history.
BEGIN;
DO $migration$
DECLARE
  routine regprocedure := to_regprocedure('public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)');
  body text; definition text; restored text;
BEGIN
  LOCK TABLE public.engine_override_events IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.engine_override_events WHERE event_type = 'manual_resume') THEN
    RAISE EXCEPTION 'Resume history exists; rollback refused.';
  END IF;
  SELECT prosrc, pg_get_functiondef(oid) INTO body, definition FROM pg_proc WHERE oid = routine;
  restored := regexp_replace(body, '    -- 0162 primary-resume begin.*?    -- 0162 primary-resume end\r?\n', '', 's');
  IF restored IS NOT DISTINCT FROM body OR md5(replace(restored, E'\r\n', E'\n')) <> '25a51e75f44b9ecbe08c7f37510c278b' THEN
    RAISE EXCEPTION 'Unexpected training schedule function; resume rollback refused.';
  END IF;
  EXECUTE replace(definition, body, restored);
END $migration$;
ALTER TABLE public.engine_override_events DROP CONSTRAINT engine_override_events_event_type_check;
ALTER TABLE public.engine_override_events ADD CONSTRAINT engine_override_events_event_type_check
  CHECK (event_type IN ('skip', 'swap', 'manual_end', 'custom'));
COMMIT;
