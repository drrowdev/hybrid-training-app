-- ADR 0085. No existing rows or policies change.
-- One transaction, including installation. Existing swim function ownership stays intact.
-- Exact 0147 RPC bodies are still the main-0155 baseline; later swimming
-- migrations replace their validators, not these entrypoints.
DO $$
DECLARE definition text; validated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated INTO definition, validated
  FROM pg_constraint WHERE conrelid = 'public.training_blocks'::regclass
    AND conname = 'training_blocks_days_per_week_check' AND contype = 'c';
  IF definition IS DISTINCT FROM 'CHECK (((days_per_week IS NULL) OR ((days_per_week >= 2) AND (days_per_week <= 7))))'
    OR validated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Modular scheduling requires the exact validated training-day constraint.';
  END IF;
END $$;
ALTER TABLE public.training_blocks DROP CONSTRAINT training_blocks_days_per_week_check;
ALTER TABLE public.training_blocks ADD CONSTRAINT training_blocks_days_per_week_check
  CHECK (days_per_week IS NULL OR days_per_week BETWEEN 2 AND 7
    OR (days_per_week = 1 AND program_id IS NOT DISTINCT FROM 'authored'));

DO $$
DECLARE
  entry record; routine oid; body text; definition text; original_attributes jsonb;
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
    IF routine IS NULL OR md5(replace(body, E'\r\n', E'\n')) IS DISTINCT FROM entry.fingerprint
       OR (SELECT pg_get_userbyid(proowner) <> 'swim_writer' OR NOT prosecdef FROM pg_proc WHERE oid = routine) THEN
      RAISE EXCEPTION 'Modular scheduling requires the exact main-0155 swimming RPC baseline: %', entry.signature;
    END IF;
    EXECUTE replace(definition, body, regexp_replace(body, E'\\mBEGIN\\M', 'BEGIN' || prefix));
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM original_attributes THEN
      RAISE EXCEPTION 'Swimming function permissions changed unexpectedly.';
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE entry record; routine oid; body text; definition text; original_attributes jsonb; prefix text;
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
    IF routine IS NULL OR md5(replace(body, E'\r\n', E'\n')) IS DISTINCT FROM entry.fingerprint
      OR (SELECT prosecdef FROM pg_proc WHERE oid = routine) THEN
      RAISE EXCEPTION 'Modular scheduling requires the exact main-0155 session RPC baseline: %', entry.signature;
    END IF;
    prefix := E'\n  -- ADR0085 common lock before session locks.\n  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''program-deploy:'' || '
      || entry.identity_expression || '::text, 0));';
    EXECUTE replace(definition, body, regexp_replace(body, E'\\mBEGIN\\M', 'BEGIN' || prefix));
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM original_attributes THEN
      RAISE EXCEPTION 'Session function permissions changed unexpectedly.';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.training_schedule_lock()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE u uuid;
BEGIN
  IF current_user = 'swim_writer' THEN
    u := public.swim_request_user_id();
  ELSE
    u := auth.uid();
  END IF;
  IF u IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.training_schedule_lock() FROM PUBLIC, anon;

-- Statement triggers acquire the lock before row locks, including direct legacy writes.
CREATE TRIGGER training_blocks_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.training_blocks
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER planned_sessions_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.planned_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER program_instances_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.program_instances
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER swim_plans_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.swim_plans
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER swim_workouts_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.swim_workouts
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER sessions_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER set_logs_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.set_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER cardio_logs_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.cardio_logs
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();

CREATE FUNCTION public.training_schedule_snapshot()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE u uuid := auth.uid(); snapshot jsonb; entries jsonb; zone text;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  SELECT COALESCE(timezone, 'UTC') INTO zone FROM public.profiles WHERE id = u;
  zone := COALESCE(zone, 'UTC');
  SELECT jsonb_build_object(
    'blocks', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM public.training_blocks b WHERE b.user_id = u), '[]'::jsonb),
    'planned', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.planned_sessions p WHERE p.user_id = u), '[]'::jsonb),
    'programs', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.program_instances i WHERE i.user_id = u), '[]'::jsonb),
    'swimPlans', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.swim_plans s WHERE s.user_id = u), '[]'::jsonb),
    'swims', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.swim_workouts w WHERE w.user_id = u), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_array(s.id, s.performed_at, s.completed_at, s.deleted_at) ORDER BY s.id)
      FROM public.sessions s WHERE s.user_id = u), '[]'::jsonb),
    'timezone', zone
  ) INTO snapshot;
  WITH commitments AS (
    SELECT p.id::text AS id, 'primary'::text AS source, b.id::text AS program_id, 'primary:' || b.id::text AS occupancy_key,
      COALESCE((SELECT (s.performed_at AT TIME ZONE zone)::date FROM public.sessions s WHERE s.id = p.completed_session_id AND s.user_id = u),
        b.started_on - (extract(isodow FROM b.started_on)::integer - 1) + p.week_index * 7 + p.day_index)::text AS date,
      COALESCE(p.title, b.notes, 'Workout') AS title,
      CASE WHEN p.completed_session_id IS NOT NULL THEN CASE
        WHEN EXISTS (SELECT 1 FROM public.sessions s WHERE s.user_id = u AND s.id = p.completed_session_id AND s.completed_at IS NOT NULL) THEN 'completed' ELSE 'started' END
        WHEN p.role = 'rest' THEN 'rest' ELSE 'scheduled' END AS state
    FROM public.planned_sessions p JOIN public.training_blocks b ON b.id = p.block_id AND b.user_id = u
    WHERE p.user_id = u AND b.status = 'active' AND b.deleted_at IS NULL AND p.skipped_at IS NULL
    UNION ALL
    SELECT w.id::text, 'swim', s.id::text, 'swim:' || s.id::text, w.scheduled_date::text,
      COALESCE(w.definition->'courseSource'->>'title', 'Swimming'),
      CASE WHEN w.status = 'completed' THEN 'completed' WHEN w.status = 'started' THEN 'started'
        WHEN s.status = 'paused' THEN 'paused' ELSE 'scheduled' END
    FROM public.swim_workouts w JOIN public.swim_plans s ON s.id = w.plan_id AND s.user_id = u
    WHERE w.user_id = u AND s.status IN ('active', 'paused') AND w.status <> 'skipped'
    UNION ALL
    SELECT s.id::text, 'session', NULL::text,
      COALESCE((SELECT 'primary:' || p.block_id::text FROM public.planned_sessions p WHERE p.user_id = u AND p.completed_session_id = s.id LIMIT 1),
        (SELECT 'swim:' || w.plan_id::text FROM public.swim_workouts w WHERE w.user_id = u AND w.session_id = s.id LIMIT 1),
        'session:' || s.id::text),
      COALESCE((SELECT w.scheduled_date FROM public.swim_workouts w WHERE w.user_id = u AND w.session_id = s.id LIMIT 1),
        (s.performed_at AT TIME ZONE zone)::date)::text,
      COALESCE(s.title, 'Workout'), CASE WHEN s.completed_at IS NULL THEN 'started' ELSE 'completed' END
    FROM public.sessions s
    WHERE s.user_id = u AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.planned_sessions p JOIN public.training_blocks b ON b.id = p.block_id
        WHERE p.user_id = u AND p.completed_session_id = s.id
          AND b.user_id = u AND b.status = 'active' AND b.deleted_at IS NULL AND p.skipped_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.swim_workouts w JOIN public.swim_plans p ON p.id = w.plan_id
        WHERE w.user_id = u AND w.session_id = s.id AND p.user_id = u AND p.status IN ('active', 'paused'))
    UNION ALL
    SELECT 'rest:' || b.id::text || ':' || d::date::text, 'primary', b.id::text, 'primary:' || b.id::text, d::date::text, 'Planned rest', 'rest'
    FROM public.training_blocks b
    CROSS JOIN LATERAL generate_series(b.started_on::timestamp,
      (b.started_on - (extract(isodow FROM b.started_on)::integer - 1) + b.weeks * 7 - 1)::timestamp, interval '1 day') d
    WHERE b.user_id = u AND b.status = 'active' AND b.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.planned_sessions p WHERE p.user_id = u AND p.block_id = b.id
        AND b.started_on - (extract(isodow FROM b.started_on)::integer - 1) + p.week_index * 7 + p.day_index = d::date)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'source', source, 'programId', program_id,
    'date', date, 'title', title, 'state', state, 'occupancyKey', occupancy_key) ORDER BY date, source, id), '[]'::jsonb)
  INTO entries FROM commitments;
  RETURN jsonb_build_object('revision', md5(snapshot::text), 'entries', entries);
END $$;
REVOKE ALL ON FUNCTION public.training_schedule_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_schedule_snapshot() TO authenticated;

CREATE FUNCTION public.training_schedule_commit(
  p_operation text, p_args jsonb, p_expected_revision text,
  p_request_id uuid, p_input_hash text, p_accept_overlap boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  u uuid := auth.uid(); before_snapshot jsonb; after_snapshot jsonb; receipt jsonb; result jsonb;
  overlap jsonb; source public.planned_sessions%ROWTYPE; target public.planned_sessions%ROWTYPE;
  block public.training_blocks%ROWTYPE; new_week integer; new_day integer; entry jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'A valid save request is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  SELECT context INTO receipt FROM public.engine_override_events WHERE id = p_request_id AND user_id = u;
  IF FOUND THEN
    IF receipt->>'operation' IS DISTINCT FROM p_operation OR receipt->>'inputHash' IS DISTINCT FROM p_input_hash
       OR receipt->>'kind' IS DISTINCT FROM 'training-schedule-v1' THEN
      RAISE EXCEPTION 'This save request was already used for a different change.' USING ERRCODE = '22023';
    END IF;
    RETURN receipt->'result';
  END IF;
  before_snapshot := public.training_schedule_snapshot();
  IF p_expected_revision IS DISTINCT FROM before_snapshot->>'revision' THEN
    RAISE EXCEPTION 'Your schedule changed. Review the dates again.' USING ERRCODE = '40001';
  END IF;
  IF p_operation IN ('primary-create', 'primary-update') THEN
    FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(p_args->'p_training_max_drafts', '[]'::jsonb)) LOOP
      IF (entry->>'oneRmKg')::numeric IS NULL OR (entry->>'oneRmKg')::numeric <= 0 OR (entry->>'oneRmKg')::numeric > 1000
        OR NOT EXISTS (SELECT 1 FROM public.movements m WHERE m.id = (entry->>'movementId')::uuid
          AND (m.user_id IS NULL OR m.user_id = u)) THEN
        RAISE EXCEPTION 'Choose an available exercise and a valid training max.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,source)
        VALUES (u,(entry->>'movementId')::uuid,(entry->>'oneRmKg')::numeric,'entered')
      ON CONFLICT (user_id,movement_id) DO UPDATE SET one_rm_kg = EXCLUDED.one_rm_kg, source = 'entered',
        derived_from_session_id = NULL, derived_from_set_log_id = NULL, derived_formula = NULL, derived_at = NULL;
    END LOOP;
  END IF;
  CASE p_operation
    WHEN 'primary-create' THEN
      IF EXISTS (SELECT 1 FROM public.training_blocks b WHERE b.user_id = u AND b.status = 'active' AND b.deleted_at IS NULL
        AND b.id IS DISTINCT FROM (p_args->>'p_replace_block_id')::uuid) THEN
        RAISE EXCEPTION 'Confirm the current program replacement before saving.' USING ERRCODE = '22023';
      END IF;
      SELECT to_jsonb(created) INTO result FROM public.deploy_program_instance_atomically(
        p_args->'p_block', p_args->'p_planned_sessions', p_args->'p_tm_percents', p_args->'p_program_instance'
      ) created;
      result := result || jsonb_build_object('skipped', COALESCE((p_args->>'p_skipped')::integer, 0));
    WHEN 'primary-update' THEN
      result := jsonb_build_object('block_id', p_args->>'p_block_id', 'program_instance_id', public.update_program_instance_atomically(
        (p_args->>'p_block_id')::uuid, p_args->'p_strength_updates', p_args->'p_deletions',
        p_args->'p_insertions', p_args->'p_block_metadata', p_args->'p_tm_percents', p_args->'p_program_instance'
      ), 'skipped', COALESCE((p_args->>'p_skipped')::integer, 0), 'todayLeftAsIs', p_args->'p_today_left_as_is');
    WHEN 'swim-create' THEN
      result := public.swim_create_plan((p_args->>'p_started_on')::date, (p_args->>'p_ends_on')::date,
        p_args->'p_definition', p_args->'p_state', p_args->'p_workouts');
    WHEN 'swim-update' THEN
      result := public.swim_update_plan((p_args->>'p_plan_id')::uuid, (p_args->>'p_expected_revision')::integer,
        p_args->'p_definition', p_args->'p_state', p_args->'p_workouts');
    WHEN 'swim-resume' THEN
      result := public.swim_resume_plan((p_args->>'p_plan_id')::uuid, (p_args->>'p_expected_revision')::integer,
        p_args->'p_definition', p_args->'p_state', p_args->'p_workouts');
    WHEN 'swim-status' THEN
      result := public.swim_set_plan_status((p_args->>'p_plan_id')::uuid, (p_args->>'p_expected_revision')::integer, p_args->>'p_status');
    WHEN 'swim-skip' THEN
      result := public.swim_skip_workout((p_args->>'p_workout_id')::uuid, (p_args->>'p_expected_revision')::integer, p_args->>'p_reason');
    WHEN 'primary-move' THEN
      SELECT * INTO source FROM public.planned_sessions WHERE id = (p_args->>'id')::uuid AND user_id = u FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Workout not found.'; END IF;
      SELECT * INTO block FROM public.training_blocks WHERE id = source.block_id AND user_id = u AND status = 'active' AND deleted_at IS NULL;
      new_week := (p_args->>'weekIndex')::integer; new_day := (p_args->>'dayIndex')::integer;
      IF block.id IS NULL OR new_week IS NULL OR new_day IS NULL OR new_week < 0 OR new_week >= block.weeks OR new_day NOT BETWEEN 0 AND 6 THEN
        RAISE EXCEPTION 'Choose a date in this program.';
      END IF;
      SELECT * INTO target FROM public.planned_sessions WHERE block_id = source.block_id AND user_id = u
        AND week_index = new_week AND day_index = new_day AND slot = source.slot AND id <> source.id FOR UPDATE;
      IF source.completed_session_id IS NOT NULL OR target.completed_session_id IS NOT NULL
        THEN RAISE EXCEPTION 'Started workouts cannot be moved.'; END IF;
      IF target.id IS NOT NULL THEN
        UPDATE public.planned_sessions SET week_index = 32000 WHERE id = source.id AND user_id = u;
        UPDATE public.planned_sessions SET week_index = source.week_index, day_index = source.day_index, planned_at = NULL,
          prescription = jsonb_set(prescription, '{meta}', COALESCE(prescription->'meta', '{}'::jsonb) || '{"userRescheduled":true}'::jsonb)
          WHERE id = target.id AND user_id = u;
      END IF;
      UPDATE public.planned_sessions SET week_index = new_week, day_index = new_day, planned_at = NULL,
        prescription = jsonb_set(prescription, '{meta}', COALESCE(prescription->'meta', '{}'::jsonb) || '{"userRescheduled":true}'::jsonb)
        WHERE id = source.id AND user_id = u;
      result := jsonb_build_object('id', source.id);
    WHEN 'primary-unskip' THEN
      UPDATE public.planned_sessions p SET skipped_at = NULL WHERE p.id = (p_args->>'id')::uuid AND p.user_id = u
        AND p.completed_session_id IS NULL AND EXISTS (SELECT 1 FROM public.training_blocks b
          WHERE b.id = p.block_id AND b.user_id = u AND b.status = 'active' AND b.deleted_at IS NULL);
      IF NOT FOUND THEN RAISE EXCEPTION 'Only unstarted workouts in an active program can be restored.'; END IF;
      result := jsonb_build_object('id', p_args->>'id');
    WHEN 'primary-skip' THEN
      UPDATE public.planned_sessions SET skipped_at = now()
        WHERE id = (p_args->>'id')::uuid AND user_id = u AND completed_session_id IS NULL
        RETURNING * INTO source;
      IF NOT FOUND THEN RAISE EXCEPTION 'Only unstarted workouts can be skipped.'; END IF;
      INSERT INTO public.engine_override_events(user_id,event_type,planned_session_id,block_id,reason,context)
        VALUES (u,'skip',source.id,source.block_id,p_args->>'reason',
          jsonb_build_object('weekIndex',source.week_index,'dayIndex',source.day_index));
      result := jsonb_build_object('id', source.id);
    WHEN 'primary-end' THEN
      UPDATE public.training_blocks SET status = 'archived', archived_at = COALESCE(archived_at,now()),
        ended_at = COALESCE(ended_at,now()), updated_at = now()
        WHERE id = (p_args->>'id')::uuid AND user_id = u RETURNING * INTO block;
      IF NOT FOUND THEN RAISE EXCEPTION 'Program not found.'; END IF;
      UPDATE public.program_instances SET status = 'archived', updated_at = now() WHERE block_id = block.id AND user_id = u;
      INSERT INTO public.engine_override_events(user_id,event_type,block_id,reason,context)
        VALUES (u,'manual_end',block.id,p_args->>'reason',jsonb_build_object('archetype',block.archetype,'weeks',block.weeks));
      result := jsonb_build_object('id', block.id);
    WHEN 'primary-delete' THEN
      UPDATE public.training_blocks SET deleted_at = now() WHERE id = (p_args->>'id')::uuid AND user_id = u;
      IF NOT FOUND THEN RAISE EXCEPTION 'Program not found.'; END IF;
      UPDATE public.program_instances SET deleted_at = now() WHERE block_id = (p_args->>'id')::uuid AND user_id = u;
      result := jsonb_build_object('id', p_args->>'id');
    WHEN 'primary-restore' THEN
      UPDATE public.training_blocks SET deleted_at = NULL WHERE id = (p_args->>'id')::uuid AND user_id = u;
      IF NOT FOUND THEN RAISE EXCEPTION 'Program not found.'; END IF;
      UPDATE public.program_instances SET deleted_at = NULL WHERE block_id = (p_args->>'id')::uuid AND user_id = u;
      result := jsonb_build_object('id', p_args->>'id');
    WHEN 'authored-workout' THEN
      FOR entry IN SELECT value FROM jsonb_array_elements(p_args->'updates') LOOP
        SELECT * INTO source FROM public.planned_sessions WHERE id = (entry->>'id')::uuid AND user_id = u FOR UPDATE;
        IF NOT FOUND OR source.block_id IS DISTINCT FROM (p_args->>'blockId')::uuid OR source.completed_session_id IS NOT NULL OR source.skipped_at IS NOT NULL OR
          NOT EXISTS (SELECT 1 FROM public.training_blocks b WHERE b.id = source.block_id AND b.user_id = u
            AND b.program_id = 'authored' AND b.status = 'active' AND b.deleted_at IS NULL
            AND b.started_on - (extract(isodow FROM b.started_on)::integer - 1) + source.week_index * 7 + source.day_index >=
              (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.profiles WHERE id = u), 'UTC'))::date)
        THEN RAISE EXCEPTION 'Only upcoming, unstarted workouts can be edited.'; END IF;
        UPDATE public.planned_sessions SET title = entry->>'title', role = entry->>'role',
          session_modality = entry->>'session_modality', effective_stress_load = (entry->>'effective_stress_load')::numeric,
          prescription = (entry->'prescription') || '{"userEdited":true}'::jsonb
          WHERE id = source.id AND user_id = u;
      END LOOP;
      IF jsonb_typeof(p_args->'definition') = 'object' THEN
        UPDATE public.program_instances SET instance = p_args->'definition',
          setup_input = jsonb_set(setup_input, '{definition}', p_args->'definition'), updated_at = now()
          WHERE user_id = u AND block_id = (p_args->>'blockId')::uuid AND program_id = 'authored' AND status = 'active' AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'Program not found.'; END IF;
      END IF;
      result := jsonb_build_object('updated', jsonb_array_length(p_args->'updates'));
    ELSE RAISE EXCEPTION 'Unsupported schedule change.' USING ERRCODE = '22023';
  END CASE;
  IF p_operation IN ('primary-create','primary-update') AND p_args ? 'p_rehab_bindings' THEN
    DELETE FROM public.program_rehab_bindings
      WHERE program_instance_id = (result->>'program_instance_id')::uuid AND user_id = u;
    INSERT INTO public.program_rehab_bindings(program_instance_id,local_protocol_id,rehab_protocol_id,user_id)
      SELECT (result->>'program_instance_id')::uuid, binding->>'localProtocolId', (binding->>'rehabProtocolId')::uuid, u
      FROM jsonb_array_elements(p_args->'p_rehab_bindings') binding;
  END IF;
  IF p_operation = 'primary-create' AND p_args->>'p_accept_recovery' = 'true' THEN
    UPDATE public.program_recommendations SET status = 'accepted', resolved_at = now()
      WHERE user_id = u AND kind = 'deload' AND status = 'pending';
  END IF;
  after_snapshot := public.training_schedule_snapshot();
  -- Compare date/source/program pairs, not regenerated row IDs. An unchanged
  -- accepted two-workout day does not need fresh consent after a notes edit.
  WITH before_pairs AS (
    SELECT a->>'date' AS date, a->>'occupancyKey' AS a, b->>'occupancyKey' AS b
    FROM jsonb_array_elements(before_snapshot->'entries') a
    CROSS JOIN jsonb_array_elements(before_snapshot->'entries') b
    WHERE a->>'date' = b->>'date' AND a->>'state' NOT IN ('rest','paused') AND b->>'state' NOT IN ('rest','paused')
      AND a->>'occupancyKey' < b->>'occupancyKey'
  ), after_pairs AS (
    SELECT DISTINCT a->>'date' AS date, a->>'occupancyKey' AS a, b->>'occupancyKey' AS b
    FROM jsonb_array_elements(after_snapshot->'entries') a
    CROSS JOIN jsonb_array_elements(after_snapshot->'entries') b
    WHERE a->>'date' = b->>'date' AND a->>'state' NOT IN ('rest','paused') AND b->>'state' NOT IN ('rest','paused')
      AND a->>'occupancyKey' < b->>'occupancyKey'
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO overlap FROM
    (SELECT * FROM after_pairs EXCEPT SELECT * FROM before_pairs) p;
  IF jsonb_array_length(overlap) > 0 AND p_accept_overlap IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Review and accept the overlapping workouts before saving.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.engine_override_events(id, user_id, event_type, context)
    VALUES (p_request_id, u, 'custom', jsonb_build_object('kind', 'training-schedule-v1',
      'operation', p_operation, 'inputHash', p_input_hash, 'revision', p_expected_revision,
      'acceptedOverlap', p_accept_overlap, 'overlaps', overlap, 'result', result));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.training_schedule_commit(text,jsonb,text,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_schedule_commit(text,jsonb,text,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.start_planned_session_atomically(p_planned_id uuid, p_performed_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE u uuid := auth.uid(); planned public.planned_sessions%ROWTYPE; previous public.sessions%ROWTYPE; result uuid;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  SELECT * INTO planned FROM public.planned_sessions WHERE id = p_planned_id AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workout not found.'; END IF;
  IF planned.completed_session_id IS NOT NULL THEN
    SELECT * INTO previous FROM public.sessions WHERE id = planned.completed_session_id AND user_id = u FOR UPDATE;
    IF previous.id IS NOT NULL AND previous.deleted_at IS NULL THEN RETURN previous.id; END IF;
    IF previous.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Restore this completed workout from Trash first.'; END IF;
  END IF;
  INSERT INTO public.sessions(user_id,title,slot,planned_at,performed_at,prescription)
    VALUES (u,planned.title,planned.slot,planned.planned_at,COALESCE(p_performed_at,now()),planned.prescription) RETURNING id INTO result;
  UPDATE public.planned_sessions SET completed_session_id = result WHERE id = planned.id AND user_id = u;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.start_planned_session_atomically(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_planned_session_atomically(uuid,timestamptz) TO authenticated;
