-- Roll back the app first. Pending authored-test suggestions stay and are refused until dismissed or the app is restored.
BEGIN;
DO $migration$
DECLARE
  routine regprocedure := to_regprocedure('public.decide_max_suggestions(uuid[],boolean)');
  body text; definition text; restored text; attributes jsonb;
BEGIN
  SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
    INTO body, definition, attributes FROM pg_proc WHERE oid = routine;
  restored := replace(body, $new$      -- 0165 authored test
      IF NOT EXISTS(SELECT 1 FROM public.set_logs sl JOIN public.sessions ts ON ts.id=sl.session_id AND ts.user_id=u
          WHERE sl.id=suggestion.derived_from_set_log_id AND sl.session_id=suggestion.derived_from_session_id
            AND sl.movement_id=suggestion.movement_id
            AND sl.prescribed->'authoredTest'->>'after' IN ('updateFromLoggedSet','fixedIncrease'))
        AND NOT EXISTS(SELECT 1 FROM public.sessions s
        WHERE s.id=suggestion.derived_from_session_id AND s.user_id=u$new$, $old$      IF NOT EXISTS(SELECT 1 FROM public.sessions s
        WHERE s.id=suggestion.derived_from_session_id AND s.user_id=u$old$);
  IF restored IS NOT DISTINCT FROM body OR md5(replace(restored,E'\r\n',E'\n')) IS DISTINCT FROM '1605feecfae5c45689c937e21498554f' THEN
    RAISE EXCEPTION 'Unexpected max decision function; authored test rollback refused.';
  END IF;
  EXECUTE replace(definition, body, restored);
  IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
    IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Authored test rollback changed function permissions.'; END IF;
END $migration$;
COMMIT;
