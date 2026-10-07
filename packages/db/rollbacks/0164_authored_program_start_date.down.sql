-- Roll back the app first. Never rewrite dates or remove accepted date-change history.
BEGIN;
LOCK TABLE public.training_blocks, public.planned_sessions, public.program_instances, public.engine_override_events IN ACCESS EXCLUSIVE MODE;
DO $migration$
DECLARE entry record; routine regprocedure; body text; definition text; restored text; attributes jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM public.engine_override_events WHERE context->>'operation'='authored-start-date') THEN
    RAISE EXCEPTION 'Saved start-date history exists; rollback refused.' USING ERRCODE='55000';
  END IF;
  FOR entry IN SELECT * FROM (VALUES
    ('public.update_program_instance_atomically(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', '2fe2169da1113341c566360dbb916b6b'),
    ('public.independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean)', '96ee82effface7b2e21c65f11aac644f'),
    ('public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)', '0c3f406f4fef7048c68f59f11ca62d4c'),
    ('public.training_schedule_snapshot()', 'af9aeba030a02db03ba587862e8d6d86')
  ) AS expected(signature, fingerprint) LOOP
    routine := to_regprocedure(entry.signature);
    SELECT prosrc,pg_get_functiondef(oid),jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
      INTO body,definition,attributes FROM pg_proc WHERE oid=routine;
    restored := body;
    IF entry.signature LIKE 'public.update_program_instance_atomically(%' THEN
      restored := regexp_replace(restored, '  -- 0164 declarations begin.*?  -- 0164 declarations end\r?\n', '', 's');
      restored := regexp_replace(restored, '  -- 0164 date reconciliation begin.*?  -- 0164 date reconciliation end', $old$  PERFORM public.rewrite_planned_sessions_atomically(
    p_block_id, p_strength_updates, p_deletions, p_insertions
  );$old$, 's');
      restored := replace(restored, $new$     SET started_on = CASE WHEN v_date_changed THEN v_date ELSE block.started_on END,
         weeks = metadata.weeks,$new$, '     SET weeks = metadata.weeks,');
    ELSIF entry.signature LIKE 'public.independent_program_schedule_commit(%' THEN
      restored := replace(restored, '(''primary-update'',''authored-workout'',''authored-start-date'')', '(''primary-update'',''authored-workout'')');
      restored := replace(restored, 'IF p_operation IN (''primary-update'',''authored-start-date'') THEN', 'IF p_operation=''primary-update'' THEN');
    ELSIF entry.signature LIKE 'public.training_schedule_commit(%' THEN
      restored := regexp_replace(restored, '  -- 0164 date operation begin.*?  -- 0164 date operation end\r?\n', '', 's');
      restored := replace(restored, '(''primary-create'', ''primary-update'', ''authored-start-date'')', '(''primary-create'', ''primary-update'')');
      restored := replace(restored, '(''primary-create'',''primary-update'',''authored-start-date'')', '(''primary-create'',''primary-update'')');
      restored := replace(restored, 'WHEN ''primary-update'', ''authored-start-date'' THEN', 'WHEN ''primary-update'' THEN');
    ELSE
      restored := replace(restored, 'RETURN jsonb_build_object(''revision'', md5(snapshot::text), ''entries'', entries, ''authoredStartDateChanges'', true);',
        'RETURN jsonb_build_object(''revision'', md5(snapshot::text), ''entries'', entries);');
    END IF;
    IF restored IS NOT DISTINCT FROM body OR md5(replace(restored,E'\r\n',E'\n')) IS DISTINCT FROM entry.fingerprint THEN
      RAISE EXCEPTION 'Unexpected function body; start-date rollback refused.';
    END IF;
    EXECUTE replace(definition,body,restored);
    IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
      IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Start-date rollback changed function permissions.'; END IF;
  END LOOP;
END $migration$;
COMMIT;
