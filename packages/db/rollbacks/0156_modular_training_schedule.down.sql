BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.engine_override_events WHERE context->>'kind' = 'training-schedule-v1')
    OR EXISTS (SELECT 1 FROM public.program_instances WHERE program_id = 'authored') THEN
    RAISE EXCEPTION 'Modular scheduling has been used. Retain its receipts and deploy a forward repair; rollback refused.';
  END IF;
END $$;
DO $$
DECLARE
  entry record; routine oid; body text; restored text; definition text; original_attributes jsonb;
  prefix text := E'\n  -- ADR0085 common lock before swimming locks.\n  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''program-deploy:'' || public.swim_request_user_id()::text, 0));';
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.swim_create_plan(date,date,jsonb,jsonb,jsonb)', '732a84239559ea42cddfa92b34e76008'),
    ('public.swim_start_workout(uuid,integer)', '34d72608d4b43c45f048d92c33f17b98'),
    ('public.swim_set_plan_status(uuid,integer,text)', 'cc013c6a3475b421ab1d49ed9284fc42'),
    ('public.swim_skip_workout(uuid,integer,text)', '9d52fa2a62e73d40b3c55653b07ae71a'),
    ('public.swim_update_plan(uuid,integer,jsonb,jsonb,jsonb)', '4213a780ac7e9b5f82b1e2f76b54e406'),
    ('public.swim_resume_plan(uuid,integer,jsonb,jsonb,jsonb)', '831b4fb8761890802adda635e185bbe1'),
    ('public.swim_complete_workout(uuid,integer,jsonb,uuid,uuid,text,boolean)', '360c98a1f8f63e0fd9fe137fdde032ce'),
    ('public.swim_edit_result(uuid,integer,jsonb,text,boolean,boolean)', '76bde3a44c3887a59d70187debc9e73a')
  ) AS baseline(signature, fingerprint) LOOP
    routine := to_regprocedure(entry.signature);
    SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner, prosecdef, proconfig, proacl::text)
      INTO body, definition, original_attributes FROM pg_proc WHERE oid = routine;
    restored := replace(body, prefix, '');
    IF routine IS NULL OR restored IS NOT DISTINCT FROM body OR md5(replace(restored, E'\r\n', E'\n')) IS DISTINCT FROM entry.fingerprint THEN
      RAISE EXCEPTION 'Swimming RPC changed after modular scheduling; rollback refused: %', entry.signature;
    END IF;
    EXECUTE replace(definition, body, restored);
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM original_attributes THEN
      RAISE EXCEPTION 'Swimming function permissions changed unexpectedly.';
    END IF;
  END LOOP;
END $$;
DO $$
DECLARE entry record; routine oid; body text; restored text; definition text; original_attributes jsonb; prefix text;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.complete_training_session_with_transition(uuid,text,uuid)', '444479bb1e70d5e1a3c1f818e070cd6d', 'public.swim_request_user_id()'),
    ('public.replace_hyrox_session_actuals(uuid,jsonb,jsonb,integer,numeric,text)', 'fea474bf2569b8ec097665b26f54501d', 'auth.uid()'),
    ('public.insert_deload_week(uuid,uuid,integer,jsonb)', 'e71f9b8d5ebdd344ba0d0cf73a993127', 'auth.uid()'),
    ('public.insert_set_logs_with_bw_progress(jsonb)', 'b51bcc889062c892efacb2b43fa557e4', 'auth.uid()')
  ) AS baseline(signature, fingerprint, identity_expression) LOOP
    routine := to_regprocedure(entry.signature);
    SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner, prosecdef, proconfig, proacl::text)
      INTO body, definition, original_attributes FROM pg_proc WHERE oid = routine;
    prefix := E'\n  -- ADR0085 common lock before session locks.\n  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''program-deploy:'' || '
      || entry.identity_expression || '::text, 0));';
    restored := replace(body, prefix, '');
    IF routine IS NULL OR restored IS NOT DISTINCT FROM body OR md5(replace(restored, E'\r\n', E'\n')) IS DISTINCT FROM entry.fingerprint THEN
      RAISE EXCEPTION 'Session RPC changed after modular scheduling; rollback refused: %', entry.signature;
    END IF;
    EXECUTE replace(definition, body, restored);
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM original_attributes THEN
      RAISE EXCEPTION 'Session function permissions changed unexpectedly.';
    END IF;
  END LOOP;
END $$;
DROP FUNCTION public.training_schedule_commit(text,jsonb,text,uuid,text,boolean);
DROP FUNCTION public.start_planned_session_atomically(uuid,timestamptz);
DROP FUNCTION public.training_schedule_snapshot();
DROP TRIGGER training_blocks_schedule_lock ON public.training_blocks;
DROP TRIGGER planned_sessions_schedule_lock ON public.planned_sessions;
DROP TRIGGER program_instances_schedule_lock ON public.program_instances;
DROP TRIGGER swim_plans_schedule_lock ON public.swim_plans;
DROP TRIGGER swim_workouts_schedule_lock ON public.swim_workouts;
DROP TRIGGER sessions_schedule_lock ON public.sessions;
DROP TRIGGER set_logs_schedule_lock ON public.set_logs;
DROP TRIGGER cardio_logs_schedule_lock ON public.cardio_logs;
DROP FUNCTION public.training_schedule_lock();
COMMIT;
