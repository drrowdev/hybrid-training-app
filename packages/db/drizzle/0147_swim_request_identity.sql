-- ADR 0079: private native identity lookup; existing function owners and ACLs stay intact.
-- Drizzle applies this entire migration atomically (no statement breakpoints).
DO $$
BEGIN
  IF pg_catalog.has_schema_privilege(
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'),
    pg_catalog.to_regnamespace('auth'), 'USAGE'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Swimming identity baseline requires service_role auth USAGE.';
  END IF;
  IF pg_catalog.has_function_privilege(
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'),
    pg_catalog.to_regprocedure('auth.uid()'), 'EXECUTE'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Swimming identity baseline requires service_role auth.uid EXECUTE.';
  END IF;
  IF pg_catalog.has_function_privilege(
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'),
    pg_catalog.to_regprocedure('public.swim_local_today()'), 'EXECUTE'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Swimming identity baseline requires service_role swim_local_today EXECUTE.';
  END IF;
  IF pg_catalog.has_function_privilege(
    (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'),
    pg_catalog.to_regprocedure('public.swim_assert_start_safety(jsonb)'), 'EXECUTE'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Swimming identity baseline requires service_role swim_assert_start_safety EXECUTE.';
  END IF;
END $$;

CREATE FUNCTION public.swim_request_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT auth.uid() $$;
ALTER FUNCTION public.swim_request_user_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.swim_request_user_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_request_user_id() TO swim_writer, service_role;

CREATE OR REPLACE FUNCTION public.swim_local_today()
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.profiles WHERE id = public.swim_request_user_id()), 'UTC'
  ))::date
$$;

CREATE OR REPLACE FUNCTION public.swim_assert_start_safety(p_workout jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_regions text[]; v_slug text; v_movement_ids uuid[];
  v_allowed_ids uuid[]; v_muscle_filter_bypassed boolean;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-safety:' || public.swim_request_user_id()::text, 0));
  v_regions := public.swim_prescription_regions(p_workout);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_workout->'sections') section
    CROSS JOIN LATERAL jsonb_array_elements(section.value->'items') item
    WHERE item.value->>'effort' NOT IN ('easy','steady')
  ) THEN 'swim-intervals' ELSE 'swim-easy' END INTO v_slug;
  SELECT array_agg(id ORDER BY id) INTO v_movement_ids FROM public.movements
    WHERE slug = v_slug AND (user_id IS NULL OR user_id = public.swim_request_user_id());
  IF v_movement_ids IS NULL OR cardinality(v_movement_ids) = 0 THEN
    RAISE EXCEPTION 'Could not check swimming movements. Try again before starting.';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT allowed.id), ARRAY[]::uuid[]) INTO v_allowed_ids
    FROM public.limitations limitation
    CROSS JOIN LATERAL unnest(limitation.allowed_movement_ids) allowed(id)
    WHERE limitation.user_id = public.swim_request_user_id() AND limitation.resolved_at IS NULL;
  v_muscle_filter_bypassed := v_movement_ids <@ v_allowed_ids;
  IF EXISTS (
    SELECT 1 FROM public.limitations limitation
    CROSS JOIN LATERAL unnest(limitation.affected_movement_ids) blocked(id)
    WHERE limitation.user_id = public.swim_request_user_id() AND limitation.resolved_at IS NULL
      AND blocked.id = ANY(v_movement_ids) AND NOT (blocked.id = ANY(v_allowed_ids))
  ) THEN
    RAISE EXCEPTION 'Swimming is blocked by an active movement limitation.';
  END IF;
  -- Same active-row union as deriveLimitationsContext + MUSCLE_TO_REGION.
  -- The allow-list can bypass muscle/movement filtering, never a region block.
  -- Severity does not switch a declared block off.
  IF EXISTS (
    WITH active AS (
      SELECT region::text AS region, affected_muscles FROM public.limitations
      WHERE user_id = public.swim_request_user_id() AND resolved_at IS NULL
    ), blocked AS (
      SELECT region FROM active WHERE region IS NOT NULL
      UNION
      SELECT mapping.region FROM active
      CROSS JOIN LATERAL unnest(affected_muscles) muscle
      JOIN (VALUES
        ('calves', 'foot_ankle_calf'),
        ('quads', 'knee'),
        ('hamstrings', 'hamstring_posterior'),
        ('glutes', 'hamstring_posterior'),
        ('adductors', 'adductor_groin'),
        ('erectors', 'lumbar_trunk'),
        ('core', 'lumbar_trunk'),
        ('obliques', 'lumbar_trunk'),
        ('shoulders', 'shoulder_scapular'),
        ('traps', 'shoulder_scapular'),
        ('lats', 'shoulder_scapular'),
        ('back', 'shoulder_scapular'),
        ('chest', 'shoulder_scapular'),
        ('biceps', 'elbow_forearm'),
        ('triceps', 'elbow_forearm'),
        ('forearms', 'elbow_forearm')
      ) mapping(muscle_name, region) ON mapping.muscle_name = muscle
      WHERE NOT v_muscle_filter_bypassed
    )
    SELECT 1 FROM blocked WHERE region = ANY(v_regions)
  ) THEN
    RAISE EXCEPTION 'Review your active limitations before starting this swim.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swim_create_plan(
  p_started_on date, p_ends_on date, p_definition jsonb, p_state jsonb, p_workouts jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_user_id uuid := public.swim_request_user_id();
  v_plan public.swim_plans;
  v_workout jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || v_user_id::text, 0));
  PERFORM public.swim_validate_plan(p_definition, p_state);
  IF COALESCE(p_state->'lifecycle', '[]'::jsonb) <> '[]'::jsonb OR p_state ? 'pauseSnapshot' THEN
    RAISE EXCEPTION 'A new swimming plan has no previous lifecycle.';
  END IF;
  IF jsonb_typeof(p_workouts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_workouts) NOT BETWEEN 1 AND 366 THEN
    RAISE EXCEPTION 'Invalid swimming schedule.';
  END IF;
  INSERT INTO public.swim_plans (user_id, started_on, ends_on, definition, state)
    VALUES (v_user_id, p_started_on, p_ends_on, p_definition, p_state)
    RETURNING * INTO v_plan;
  FOR v_workout IN SELECT value FROM jsonb_array_elements(p_workouts) LOOP
    PERFORM public.swim_validate_workout(v_workout->'definition');
    PERFORM public.swim_validate_plan_binding(p_definition, v_workout->'definition', p_state);
    IF v_workout->'definition'->'original' IS DISTINCT FROM v_workout->'definition'->'issued'
       OR jsonb_array_length(v_workout->'definition'->'modifications') <> 0
       OR v_workout->'definition' ? 'skip'
       OR COALESCE(v_workout->'definition'->'resultHistory', '[]'::jsonb) <> '[]'::jsonb THEN
      RAISE EXCEPTION 'A new swimming workout starts with its original prescription.';
    END IF;
    IF (v_workout->>'scheduled_date')::date NOT BETWEEN p_started_on AND p_ends_on THEN
      RAISE EXCEPTION 'Swimming workout is outside the plan dates.';
    END IF;
    INSERT INTO public.swim_workouts (user_id, plan_id, scheduled_date, slot, definition)
      VALUES (v_user_id, v_plan.id, (v_workout->>'scheduled_date')::date,
        COALESCE((v_workout->>'slot')::public.session_slot, 'single'), v_workout->'definition');
  END LOOP;
  RETURN jsonb_build_object('plan', to_jsonb(v_plan), 'workouts', (
    SELECT jsonb_agg(to_jsonb(w) ORDER BY scheduled_date, id)
    FROM public.swim_workouts w WHERE plan_id = v_plan.id
  ));
END $$;

CREATE OR REPLACE FUNCTION public.swim_start_workout(p_workout_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_plan public.swim_plans;
  v_workout public.swim_workouts;
  v_session_id uuid;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  IF v_workout.session_id IS NULL AND v_workout.status = 'scheduled' THEN
    -- Serialize first starts before any plan lock, then reread after a concurrent
    -- creator commits. Replays never need to enter the plan-first mutation path.
    PERFORM pg_advisory_xact_lock(hashtextextended('swim-start:' || v_workout.id::text, 0));
    SELECT * INTO v_workout FROM public.swim_workouts
      WHERE id = p_workout_id AND user_id = public.swim_request_user_id();
    IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  END IF;
  -- Reopening is read-only. Never take a plan/workout lock before an existing session.
  IF v_workout.session_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.sessions
      WHERE id = v_workout.session_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Restore this session before opening it.';
    END IF;
    RETURN to_jsonb(v_workout);
  END IF;
  IF v_workout.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This swimming workout cannot be started.';
  END IF;
  SELECT p.* INTO v_plan FROM public.swim_plans p
    JOIN public.swim_workouts w ON w.plan_id = p.id
    WHERE w.id = p_workout_id AND p.user_id = public.swim_request_user_id() FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id()
      AND status = 'scheduled' AND session_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This swimming workout cannot be started.';
  END IF;
  IF v_workout.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'Resume the swimming plan first.'; END IF;
  PERFORM public.swim_assert_start_safety(v_workout.definition->'issued');
  INSERT INTO public.sessions (user_id, title, slot)
    VALUES (public.swim_request_user_id(), 'Pool swim', v_workout.slot) RETURNING id INTO v_session_id;
  UPDATE public.swim_workouts
    SET session_id = v_session_id, status = 'started',
        revision = revision + 1, updated_at = now()
    WHERE id = v_workout.id RETURNING * INTO v_workout;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now() WHERE id = v_workout.plan_id;
  RETURN to_jsonb(v_workout);
END $$;

CREATE OR REPLACE FUNCTION public.swim_set_plan_status(
  p_plan_id uuid, p_expected_revision integer, p_status text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE v_plan public.swim_plans;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || public.swim_request_user_id()::text, 0));
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = public.swim_request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  IF v_plan.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming plan changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (v_plan.status = 'active' AND p_status IN ('paused','finished','archived')) OR
    (v_plan.status = 'paused' AND p_status IN ('finished','archived')) OR
    (v_plan.status = 'finished' AND p_status = 'archived')
  ) THEN RAISE EXCEPTION 'Invalid swimming plan transition.'; END IF;
  UPDATE public.swim_plans
    SET status = p_status, revision = revision + 1, updated_at = now(),
      state = jsonb_set(state, '{lifecycle}',
        COALESCE(state->'lifecycle', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('from', v_plan.status, 'to', p_status, 'recordedAt', now())
        ))
    WHERE id = p_plan_id RETURNING * INTO v_plan;
  IF p_status = 'paused' THEN
    UPDATE public.swim_plans SET state = jsonb_set(state, '{pauseSnapshot}',
      jsonb_build_object('pausedAt', now(), 'workoutIds', COALESCE((
        SELECT jsonb_agg(id ORDER BY scheduled_date, id) FROM public.swim_workouts
        WHERE plan_id = p_plan_id AND status = 'scheduled' AND session_id IS NULL
          AND scheduled_date >= public.swim_local_today()
      ), '[]'::jsonb)))
      WHERE id = p_plan_id RETURNING * INTO v_plan;
  END IF;
  RETURN to_jsonb(v_plan);
END $$;

CREATE OR REPLACE FUNCTION public.swim_skip_workout(p_workout_id uuid, p_expected_revision integer, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE v_workout public.swim_workouts; v_plan public.swim_plans;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT p.* INTO v_plan FROM public.swim_plans p JOIN public.swim_workouts w ON w.plan_id = p.id
    WHERE w.id = p_workout_id AND p.user_id = public.swim_request_user_id() FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  IF v_plan.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active swim plan can skip workouts.';
  END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id()
      AND status = 'scheduled' AND session_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an unstarted swimming workout can be skipped.'; END IF;
  IF v_workout.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF p_reason IS NOT NULL AND (length(btrim(p_reason)) = 0 OR length(p_reason) > 1000) THEN
    RAISE EXCEPTION 'Enter a short reason for skipping.';
  END IF;
  UPDATE public.swim_workouts
    SET status = 'skipped', revision = revision + 1, updated_at = now(),
      definition = jsonb_set(definition, '{skip}', jsonb_build_object('reason', p_reason, 'recordedAt', now()))
    WHERE id = p_workout_id RETURNING * INTO v_workout;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now() WHERE id = v_workout.plan_id;
  RETURN to_jsonb(v_workout);
END $$;

CREATE OR REPLACE FUNCTION public.swim_update_plan(
  p_plan_id uuid, p_expected_revision integer,
  p_definition jsonb, p_state jsonb, p_workouts jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_plan public.swim_plans;
  v_workout public.swim_workouts;
  v_update jsonb;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = public.swim_request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  IF v_plan.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming plan changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF v_plan.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'This swimming plan is no longer editable.';
  END IF;
  IF p_definition IS DISTINCT FROM v_plan.definition THEN
    RAISE EXCEPTION 'Create a new swimming plan to change its setup.';
  END IF;
  PERFORM public.swim_validate_plan(p_definition, p_state);
  PERFORM public.swim_validate_state_append(v_plan.state, p_state);
  IF jsonb_typeof(p_workouts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_workouts) > 366 THEN
    RAISE EXCEPTION 'Invalid swimming workout updates.';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_workouts)) THEN
    RAISE EXCEPTION 'A swimming workout cannot be updated twice.';
  END IF;
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_workouts) ORDER BY value->>'id' LOOP
    SELECT * INTO v_workout FROM public.swim_workouts
      WHERE id = (v_update->>'id')::uuid AND plan_id = p_plan_id AND user_id = public.swim_request_user_id()
        AND status = 'scheduled' AND session_id IS NULL
        AND scheduled_date >= public.swim_local_today()
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only future unstarted swimming workouts can change.'; END IF;
    IF v_workout.revision IS DISTINCT FROM (v_update->>'expected_revision')::integer THEN
      RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
    END IF;
    PERFORM public.swim_validate_workout(v_update->'definition');
    PERFORM public.swim_validate_plan_binding(p_definition, v_update->'definition', p_state, v_workout.definition);
    PERFORM public.swim_validate_workout_append(v_workout.definition, v_update->'definition');
    IF v_workout.definition->'issued' IS DISTINCT FROM v_update->'definition'->'issued'
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_state->'decisions') WITH ORDINALITY d(value, position)
         WHERE position > jsonb_array_length(v_plan.state->'decisions')
           AND value->>'decision' IN ('accepted','overridden')
           AND value->>'id' = v_update->'definition'->'modifications'-> (-1) ->>'decisionId'
       ) THEN RAISE EXCEPTION 'Accept a swimming decision before changing issued work.'; END IF;
    IF (v_update->>'scheduled_date')::date NOT BETWEEN GREATEST(v_plan.started_on, public.swim_local_today()) AND v_plan.ends_on THEN
      RAISE EXCEPTION 'Swimming workout is outside the future plan dates.';
    END IF;
    UPDATE public.swim_workouts
      SET definition = v_update->'definition',
          scheduled_date = (v_update->>'scheduled_date')::date,
          slot = (v_update->>'slot')::public.session_slot,
          revision = revision + 1, updated_at = now()
      WHERE id = v_workout.id;
  END LOOP;
  UPDATE public.swim_plans
    SET definition = p_definition, state = p_state, revision = revision + 1, updated_at = now()
    WHERE id = p_plan_id RETURNING * INTO v_plan;
  RETURN jsonb_build_object('plan', to_jsonb(v_plan), 'workouts', (
    SELECT jsonb_agg(to_jsonb(w) ORDER BY scheduled_date, id)
    FROM public.swim_workouts w WHERE plan_id = p_plan_id
  ));
END $$;

CREATE OR REPLACE FUNCTION public.swim_resume_plan(
  p_plan_id uuid, p_expected_revision integer,
  p_definition jsonb, p_state jsonb, p_workouts jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_plan public.swim_plans; v_workout public.swim_workouts;
  v_update jsonb; v_remaining integer; v_end date;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || public.swim_request_user_id()::text, 0));
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = public.swim_request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  IF v_plan.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming plan changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF v_plan.status <> 'paused' THEN RAISE EXCEPTION 'Only a paused swimming plan can resume.'; END IF;
  PERFORM public.swim_validate_plan(p_definition, p_state);
  PERFORM public.swim_validate_state_append(v_plan.state, p_state);
  IF p_definition IS DISTINCT FROM v_plan.definition
     OR p_state->'observations' IS DISTINCT FROM v_plan.state->'observations'
     OR p_state->'acceptedCalibration' IS DISTINCT FROM v_plan.state->'acceptedCalibration'
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_state->'decisions') WITH ORDINALITY d(value, position)
       WHERE position > jsonb_array_length(v_plan.state->'decisions')
         AND value->>'kind' = 'schedule' AND value->>'decision' IN ('accepted','overridden')
     ) THEN RAISE EXCEPTION 'Review the remaining swimming dates before resuming.'; END IF;
  IF jsonb_typeof(v_plan.state->'pauseSnapshot'->'workoutIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'This swimming pause has no reviewed remaining-work snapshot.';
  END IF;
  SELECT count(*) INTO v_remaining FROM public.swim_workouts
    WHERE plan_id = p_plan_id AND status = 'scheduled' AND session_id IS NULL
      AND id IN (SELECT value::uuid FROM jsonb_array_elements_text(v_plan.state->'pauseSnapshot'->'workoutIds'));
  IF v_remaining = 0 OR jsonb_typeof(p_workouts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_workouts) <> v_remaining
     OR (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_workouts)) THEN
    RAISE EXCEPTION 'Review every remaining swimming workout before resuming.';
  END IF;
  v_end := v_plan.ends_on;
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_workouts) ORDER BY value->>'id' LOOP
    SELECT * INTO v_workout FROM public.swim_workouts
      WHERE id = (v_update->>'id')::uuid AND plan_id = p_plan_id AND user_id = public.swim_request_user_id()
        AND status = 'scheduled' AND session_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
    IF v_workout.revision IS DISTINCT FROM (v_update->>'expected_revision')::integer THEN
      RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
    END IF;
    IF v_workout.status <> 'scheduled' OR v_workout.session_id IS NOT NULL
       OR NOT (v_plan.state->'pauseSnapshot'->'workoutIds' @> jsonb_build_array(v_workout.id))
       OR v_update->'definition' IS DISTINCT FROM v_workout.definition
       OR (v_update->>'scheduled_date')::date < public.swim_local_today() THEN
      RAISE EXCEPTION 'Resume only unstarted swimming workouts on reviewed future dates.';
    END IF;
    v_end := GREATEST(v_end, (v_update->>'scheduled_date')::date);
    UPDATE public.swim_workouts SET scheduled_date = (v_update->>'scheduled_date')::date,
      slot = (v_update->>'slot')::public.session_slot, revision = revision + 1, updated_at = now()
      WHERE id = v_workout.id;
  END LOOP;
  UPDATE public.swim_plans SET status = 'active', ends_on = v_end,
    revision = revision + 1, updated_at = now(),
    state = jsonb_set(p_state, '{lifecycle}', COALESCE(p_state->'lifecycle', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('from', 'paused', 'to', 'active', 'recordedAt', now())))
    WHERE id = p_plan_id RETURNING * INTO v_plan;
  RETURN jsonb_build_object('plan', to_jsonb(v_plan), 'workouts', (
    SELECT jsonb_agg(to_jsonb(w) ORDER BY scheduled_date, id)
    FROM public.swim_workouts w WHERE plan_id = p_plan_id
  ));
END $$;

CREATE OR REPLACE FUNCTION public.swim_complete_workout(
  p_workout_id uuid, p_expected_revision integer, p_result jsonb,
  p_client_log_id uuid, p_completion_entry_id uuid,
  p_notes text DEFAULT NULL, p_allow_changed_course boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_workout public.swim_workouts;
  v_session public.sessions;
  v_summary jsonb;
  v_cardio_id uuid;
  v_transitioned boolean;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id();
  IF NOT FOUND OR v_workout.session_id IS NULL THEN
    RAISE EXCEPTION 'Start the swimming workout before completing it.';
  END IF;
  -- This lock also serializes generic logging, completion, editing and purge.
  SELECT * INTO v_session FROM public.sessions
    WHERE id = v_workout.session_id AND user_id = public.swim_request_user_id() AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming session not found.'; END IF;
  PERFORM 1 FROM public.swim_plans
    WHERE id = v_workout.plan_id AND user_id = public.swim_request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id() AND session_id = v_session.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  IF v_session.completed_at IS NOT NULL THEN
    SELECT id INTO v_cardio_id FROM public.cardio_logs
      WHERE session_id = v_session.id AND swim_result IS NOT NULL;
    IF NOT FOUND OR v_workout.status <> 'completed' THEN
      RAISE EXCEPTION 'Swimming completion is inconsistent.';
    END IF;
    -- Replay is session-based, not merely UUID-based. Never overwrite actuals.
    RETURN jsonb_build_object('workout', to_jsonb(v_workout), 'session_id', v_session.id,
      'cardio_log_id', v_cardio_id, 'transitioned', false);
  END IF;
  IF v_workout.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF v_workout.status <> 'started' OR p_client_log_id IS NULL OR p_completion_entry_id IS NULL THEN
    RAISE EXCEPTION 'Swimming completion requires a started workout and durable receipt.';
  END IF;
  PERFORM public.swim_validate_result(p_result);
  PERFORM public.swim_validate_result_course(v_workout.definition, p_result, p_allow_changed_course);
  v_summary := public.swim_result_summary(p_result);
  INSERT INTO public.cardio_logs
    (session_id, block_index, modality, duration_sec, distance_km, rpe, client_log_id, swim_result, notes)
    VALUES (v_session.id, 0, 'swimming', (v_summary->>'durationSec')::integer,
      (v_summary->>'distanceKm')::numeric, (v_summary->>'rpe')::numeric,
      p_client_log_id, p_result, p_notes)
    RETURNING id INTO v_cardio_id;
  SELECT transitioned INTO v_transitioned
    FROM public.complete_training_session_with_transition(v_session.id, p_notes, p_completion_entry_id);
  IF v_transitioned IS DISTINCT FROM true THEN RAISE EXCEPTION 'Swimming session did not complete.'; END IF;
  UPDATE public.sessions SET
    duration_min = GREATEST(1, round((v_summary->>'durationSec')::numeric / 60)::integer),
    session_rpe = (v_summary->>'rpe')::numeric
    WHERE id = v_session.id;
  UPDATE public.swim_workouts SET status = 'completed', revision = revision + 1, updated_at = now()
    WHERE id = p_workout_id RETURNING * INTO v_workout;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now() WHERE id = v_workout.plan_id;
  RETURN jsonb_build_object('workout', to_jsonb(v_workout), 'session_id', v_session.id,
    'cardio_log_id', v_cardio_id, 'transitioned', true);
END $$;

CREATE OR REPLACE FUNCTION public.swim_edit_result(
  p_workout_id uuid, p_expected_revision integer, p_result jsonb,
  p_notes text DEFAULT NULL, p_allow_changed_course boolean DEFAULT false,
  p_notes_supplied boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_workout public.swim_workouts;
  v_session public.sessions;
  v_cardio public.cardio_logs;
  v_summary jsonb;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts WHERE id = p_workout_id AND user_id = public.swim_request_user_id();
  IF NOT FOUND OR v_workout.session_id IS NULL THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  SELECT * INTO v_session FROM public.sessions
    WHERE id = v_workout.session_id AND user_id = public.swim_request_user_id() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming session not found.'; END IF;
  IF v_session.completed_at IS NULL THEN RAISE EXCEPTION 'Complete this swim before editing its result.'; END IF;
  PERFORM 1 FROM public.swim_plans
    WHERE id = v_workout.plan_id AND user_id = public.swim_request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = public.swim_request_user_id() AND session_id = v_session.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  IF v_workout.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'Swimming workout changed. Reload before continuing.' USING ERRCODE = '40001';
  END IF;
  IF v_workout.status <> 'completed' THEN RAISE EXCEPTION 'Swimming workout is not complete.'; END IF;
  SELECT * INTO v_cardio FROM public.cardio_logs
    WHERE session_id = v_session.id AND swim_result IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming result not found.'; END IF;
  PERFORM public.swim_validate_result(p_result);
  PERFORM public.swim_validate_result_course(v_workout.definition, p_result, p_allow_changed_course);
  v_summary := public.swim_result_summary(p_result);
  UPDATE public.cardio_logs SET swim_result = p_result,
    duration_sec = (v_summary->>'durationSec')::integer,
    distance_km = (v_summary->>'distanceKm')::numeric,
    rpe = (v_summary->>'rpe')::numeric,
    notes = CASE WHEN p_notes_supplied THEN p_notes ELSE notes END
    WHERE id = v_cardio.id;
  UPDATE public.sessions SET
    duration_min = GREATEST(1, round((v_summary->>'durationSec')::numeric / 60)::integer),
    session_rpe = (v_summary->>'rpe')::numeric,
    notes = CASE WHEN p_notes_supplied THEN p_notes ELSE notes END
    WHERE id = v_session.id;
  UPDATE public.swim_workouts SET definition = jsonb_set(
      definition, '{resultHistory}',
      COALESCE(definition->'resultHistory', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('result', v_cardio.swim_result, 'recordedAt', now(),
          'revision', v_workout.revision, 'notes', v_cardio.notes)
      )
    ), revision = revision + 1, updated_at = now()
    WHERE id = p_workout_id RETURNING * INTO v_workout;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now() WHERE id = v_workout.plan_id;
  RETURN jsonb_build_object('workout', to_jsonb(v_workout), 'session_id', v_session.id,
    'cardio_log_id', v_cardio.id, 'transitioned', false);
END $$;
