-- Authored Test-week suggestions: the 1RM decision RPC also accepts a pending derived
-- suggestion whose source set was logged from an authored Test week. Function-only; owner,
-- ACL, SECURITY INVOKER and search_path are preserved and checked.
DO $migration$
DECLARE
  routine regprocedure := to_regprocedure('public.decide_max_suggestions(uuid[],boolean)');
  body text; definition text; revised text; attributes jsonb;
BEGIN
  SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
    INTO body, definition, attributes FROM pg_proc WHERE oid = routine;
  IF body IS NULL OR md5(replace(body,E'\r\n',E'\n')) IS DISTINCT FROM '1605feecfae5c45689c937e21498554f' THEN
    RAISE EXCEPTION 'Unexpected max decision function; authored test migration refused.';
  END IF;
  revised := replace(body, $old$      IF NOT EXISTS(SELECT 1 FROM public.sessions s
        WHERE s.id=suggestion.derived_from_session_id AND s.user_id=u$old$, $new$      -- 0165 authored test
      IF NOT EXISTS(SELECT 1 FROM public.set_logs sl JOIN public.sessions ts ON ts.id=sl.session_id AND ts.user_id=u
          WHERE sl.id=suggestion.derived_from_set_log_id AND sl.session_id=suggestion.derived_from_session_id
            AND sl.movement_id=suggestion.movement_id
            AND sl.prescribed->'authoredTest'->>'after' IN ('updateFromLoggedSet','fixedIncrease'))
        AND NOT EXISTS(SELECT 1 FROM public.sessions s
        WHERE s.id=suggestion.derived_from_session_id AND s.user_id=u$new$);
  IF revised IS NOT DISTINCT FROM body THEN
    RAISE EXCEPTION 'Unexpected max decision function; authored test migration refused.';
  END IF;
  EXECUTE replace(definition, body, revised);
  IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
    IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Authored test migration changed function permissions.'; END IF;
END $migration$;
