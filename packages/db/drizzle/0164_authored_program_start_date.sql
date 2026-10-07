-- Explicit unused-program date changes keep the existing schedule transaction and ACLs.
DO $migration$
DECLARE
  entry record; routine regprocedure; body text; definition text; revised text; attributes jsonb;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.update_program_instance_atomically(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', '2fe2169da1113341c566360dbb916b6b'),
    ('public.independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean)', '96ee82effface7b2e21c65f11aac644f'),
    ('public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)', '0c3f406f4fef7048c68f59f11ca62d4c'),
    ('public.training_schedule_snapshot()', 'af9aeba030a02db03ba587862e8d6d86')
  ) AS expected(signature, fingerprint) LOOP
    routine := to_regprocedure(entry.signature);
    SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
      INTO body, definition, attributes FROM pg_proc WHERE oid = routine;
    IF body IS NULL OR md5(replace(body,E'\r\n',E'\n')) IS DISTINCT FROM entry.fingerprint THEN
      RAISE EXCEPTION 'Unexpected function baseline; start-date migration refused.';
    END IF;
    revised := body;
    IF entry.signature LIKE 'public.update_program_instance_atomically(%' THEN
      revised := replace(revised, '  v_instance_id uuid;', $declarations$  v_instance_id uuid;
  -- 0164 declarations begin
  v_date date; v_block public.training_blocks%ROWTYPE; v_change jsonb; v_update jsonb;
  v_date_changed boolean := false; v_index integer := 0;
  -- 0164 declarations end$declarations$);
      revised := replace(revised, $old$  PERFORM public.rewrite_planned_sessions_atomically(
    p_block_id, p_strength_updates, p_deletions, p_insertions
  );$old$, $new$  -- 0164 date reconciliation begin
  IF p_block_metadata ? 'started_on' THEN
    SELECT * INTO STRICT v_block FROM public.training_blocks
      WHERE id=p_block_id AND user_id=v_user_id AND status='active' AND deleted_at IS NULL FOR UPDATE;
    v_date := (p_block_metadata->>'started_on')::date;
    IF v_date IS NULL OR p_program_instance#>>'{setup_input,startedOn}' IS DISTINCT FROM v_date::text THEN
      RAISE EXCEPTION 'Choose a valid program start date.' USING ERRCODE='22023';
    END IF;
    v_date_changed := v_date IS DISTINCT FROM v_block.started_on;
  END IF;
  IF v_date_changed THEN
    v_change := p_block_metadata->'authored_start_date_change';
    IF v_block.program_id IS DISTINCT FROM 'authored'
      OR NOT EXISTS(SELECT 1 FROM public.program_instances i WHERE i.block_id=p_block_id AND i.user_id=v_user_id
        AND i.program_id='authored' AND i.status='active' AND i.deleted_at IS NULL)
      OR jsonb_typeof(v_change) IS DISTINCT FROM 'object'
      OR v_change->>'expected_started_on' IS DISTINCT FROM v_block.started_on::text
      OR jsonb_typeof(v_change->'updates') IS DISTINCT FROM 'array'
      OR p_program_instance->>'program_id' IS DISTINCT FROM 'authored'
      OR p_program_instance->'instance' IS DISTINCT FROM p_program_instance#>'{setup_input,definition}'
      OR COALESCE(p_strength_updates,'[]'::jsonb) <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Reload the full program before changing its start date.' USING ERRCODE='22023';
    END IF;
    IF v_date < (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.profiles WHERE id=v_user_id),'UTC'))::date THEN
      RAISE EXCEPTION 'Choose today or a future start date.' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM public.planned_sessions WHERE block_id=p_block_id AND user_id=v_user_id
      AND completed_session_id IS NOT NULL) THEN
      RAISE EXCEPTION 'The start date cannot change after a workout has started.' USING ERRCODE='40001';
    END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_change->'updates') e
      WHERE NOT EXISTS(SELECT 1 FROM public.planned_sessions p WHERE p.id=(e->>'id')::uuid
        AND p.block_id=p_block_id AND p.user_id=v_user_id)
        OR (e->>'week_index')::integer IS NULL OR (e->>'week_index')::integer NOT BETWEEN 0 AND 51
        OR (e->>'day_index')::integer IS NULL OR (e->>'day_index')::integer NOT BETWEEN 0 AND 6
        OR (e ? 'prescription' AND jsonb_typeof(e#>'{prescription,items}') IS DISTINCT FROM 'array')
    ) OR (SELECT count(*) FROM jsonb_array_elements(v_change->'updates')) <>
      (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(v_change->'updates') e) THEN
      RAISE EXCEPTION 'The saved workouts changed. Reload the program.' USING ERRCODE='40001';
    END IF;
    IF EXISTS(
      SELECT 1 FROM public.planned_sessions p WHERE p.block_id=p_block_id AND p.user_id=v_user_id
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_change->'updates') e WHERE (e->>'id')::uuid=p.id)
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_deletions,'[]'::jsonb)) e WHERE (e->>'id')::uuid=p.id)
    ) OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_change->'updates') e
      JOIN jsonb_array_elements(COALESCE(p_deletions,'[]'::jsonb)) d ON d->>'id'=e->>'id'
    ) THEN RAISE EXCEPTION 'Reload all workouts before changing the start date.' USING ERRCODE='40001'; END IF;

    PERFORM public.rewrite_planned_sessions_atomically(p_block_id,'[]'::jsonb,p_deletions,'[]'::jsonb);
    -- Park retained identities, as the deload RPC does, without deleting referenced rows.
    IF EXISTS(SELECT 1 FROM public.planned_sessions WHERE block_id=p_block_id AND user_id=v_user_id AND week_index>=1000)
      OR jsonb_array_length(v_change->'updates')>1000 THEN
      RAISE EXCEPTION 'The saved workout dates need review.' USING ERRCODE='22023';
    END IF;
    FOR v_update IN SELECT value FROM jsonb_array_elements(v_change->'updates') LOOP
      UPDATE public.planned_sessions SET week_index=1000+v_index
        WHERE id=(v_update->>'id')::uuid AND block_id=p_block_id AND user_id=v_user_id;
      v_index := v_index+1;
    END LOOP;
    FOR v_update IN SELECT value FROM jsonb_array_elements(v_change->'updates') LOOP
      UPDATE public.planned_sessions p SET week_index=(v_update->>'week_index')::smallint,
        day_index=(v_update->>'day_index')::smallint,
        title=CASE WHEN v_update ? 'prescription' THEN v_update->>'title' ELSE p.title END,
        role=CASE WHEN v_update ? 'prescription' THEN v_update->>'role' ELSE p.role END,
        prescription=CASE WHEN v_update ? 'prescription' THEN v_update->'prescription' ELSE p.prescription END,
        session_modality=CASE WHEN v_update ? 'prescription' THEN v_update->>'session_modality' ELSE p.session_modality END,
        effective_stress_load=CASE WHEN v_update ? 'prescription' THEN (v_update->>'effective_stress_load')::numeric ELSE p.effective_stress_load END
        WHERE p.id=(v_update->>'id')::uuid AND p.block_id=p_block_id AND p.user_id=v_user_id;
    END LOOP;
    PERFORM public.rewrite_planned_sessions_atomically(p_block_id,'[]'::jsonb,'[]'::jsonb,p_insertions);
  ELSE
    PERFORM public.rewrite_planned_sessions_atomically(
      p_block_id, p_strength_updates, p_deletions, p_insertions
    );
  END IF;
  -- 0164 date reconciliation end$new$);
      revised := replace(revised, '     SET weeks = metadata.weeks,', $new$     SET started_on = CASE WHEN v_date_changed THEN v_date ELSE block.started_on END,
         weeks = metadata.weeks,$new$);
    ELSIF entry.signature LIKE 'public.independent_program_schedule_commit(%' THEN
      revised := replace(revised, '(''primary-update'',''authored-workout'')', '(''primary-update'',''authored-workout'',''authored-start-date'')');
      revised := replace(revised, 'IF p_operation=''primary-update'' THEN', 'IF p_operation IN (''primary-update'',''authored-start-date'') THEN');
    ELSIF entry.signature LIKE 'public.training_schedule_commit(%' THEN
      revised := replace(revised, $old$  CASE p_operation$old$, $new$  -- 0164 date operation begin
  IF p_operation='authored-start-date' AND (
    p_args#>>'{p_block_metadata,started_on}' IS NULL
    OR jsonb_typeof(p_args#>'{p_block_metadata,authored_start_date_change}') IS DISTINCT FROM 'object'
  ) THEN RAISE EXCEPTION 'Review the program start date before saving.' USING ERRCODE='22023'; END IF;
  IF p_operation<>'authored-start-date' AND p_args#>'{p_block_metadata,started_on}' IS NOT NULL THEN
    RAISE EXCEPTION 'Edit the full program to change its start date.' USING ERRCODE='22023';
  END IF;
  -- 0164 date operation end
  CASE p_operation$new$);
      revised := replace(revised, '(''primary-create'', ''primary-update'')', '(''primary-create'', ''primary-update'', ''authored-start-date'')');
      revised := replace(revised, '(''primary-create'',''primary-update'')', '(''primary-create'',''primary-update'',''authored-start-date'')');
      revised := replace(revised, 'WHEN ''primary-update'' THEN', 'WHEN ''primary-update'', ''authored-start-date'' THEN');
    ELSE
      revised := replace(revised, 'RETURN jsonb_build_object(''revision'', md5(snapshot::text), ''entries'', entries);',
        'RETURN jsonb_build_object(''revision'', md5(snapshot::text), ''entries'', entries, ''authoredStartDateChanges'', true);');
    END IF;
    IF revised IS NOT DISTINCT FROM body THEN RAISE EXCEPTION 'Start-date function patch was not applied.'; END IF;
    EXECUTE replace(definition,body,revised);
    IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
      IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Start-date function permissions changed unexpectedly.'; END IF;
  END LOOP;
END $migration$;
