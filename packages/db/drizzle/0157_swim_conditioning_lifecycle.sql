-- Linked swimming uses the primary calendar, including after a pause.
GRANT UPDATE (status, state, updated_at) ON public.swim_plans TO conditioning_writer;
GRANT UPDATE (status, scheduled_date, definition, updated_at) ON public.swim_workouts TO conditioning_writer;

CREATE FUNCTION public.swim_conditioning_lifecycle_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.swim_conditioning_lifecycle_ready() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.swim_conditioning_lifecycle_ready() TO authenticated;

CREATE FUNCTION public.swim_conditioning_check_safety(p_plan_id uuid, p_workout_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE work public.swim_workouts;
BEGIN
  IF public.swim_request_user_id() IS NULL THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  FOR work IN SELECT * FROM public.swim_workouts WHERE user_id = public.swim_request_user_id() AND plan_id = p_plan_id
    AND session_id IS NULL AND status = 'scheduled'
    AND (id = p_workout_id OR (p_workout_id IS NULL AND scheduled_date >= public.swim_local_today()))
  LOOP
    PERFORM public.swim_assert_start_safety(work.definition->'issued');
  END LOOP;
END $$;
GRANT CREATE ON SCHEMA public TO swim_writer;
ALTER FUNCTION public.swim_conditioning_check_safety(uuid,uuid) OWNER TO swim_writer;
REVOKE CREATE ON SCHEMA public FROM swim_writer;
REVOKE ALL ON FUNCTION public.swim_conditioning_check_safety(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_conditioning_check_safety(uuid,uuid) TO conditioning_writer;

CREATE FUNCTION public.swim_conditioning_state_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state ? 'conditioningChanges' THEN
      RAISE EXCEPTION 'CONDITIONING_HISTORY_INVALID' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.state->'conditioningChanges' IS DISTINCT FROM OLD.state->'conditioningChanges'
    AND current_user <> 'conditioning_writer' THEN
    RAISE EXCEPTION 'CONDITIONING_HISTORY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.swim_conditioning_state_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER swim_conditioning_state_guard BEFORE INSERT OR UPDATE OF state ON public.swim_plans
FOR EACH ROW EXECUTE FUNCTION public.swim_conditioning_state_guard();

CREATE FUNCTION public.swim_replay_conditioning_change(p_plan_id uuid, p_request_id uuid, p_input jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE prior jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT entry.value INTO prior FROM public.swim_plans plan,
    LATERAL jsonb_array_elements(COALESCE(plan.state->'conditioningChanges','[]'::jsonb)) entry
    WHERE plan.id = p_plan_id AND plan.user_id = auth.uid() AND entry.value->>'id' = p_request_id::text;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF prior->'input' IS DISTINCT FROM p_input THEN
    RAISE EXCEPTION 'CONDITIONING_REQUEST_REUSED' USING ERRCODE = '22023';
  END IF;
  RETURN p_request_id;
END $$;
REVOKE ALL ON FUNCTION public.swim_replay_conditioning_change(uuid,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.swim_replay_conditioning_change(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.swim_change_conditioning(p_request_id uuid, p_input jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  u uuid := auth.uid();
  plan public.swim_plans;
  work public.swim_workouts;
  primary_plan public.training_blocks;
  planned public.planned_sessions;
  prior jsonb;
  command text := p_input->>'command';
  target date;
  monday date;
  today date;
  latest_outcome jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['command','planId','planRevision','workoutId','workoutRevision','date','reason','warnings'] <> '{}'::jsonb
    OR command IS NULL OR command NOT IN ('move','skip','unskip','pause','resume','finish')
    OR (p_input->>'planId' ~ '^[0-9a-f-]{36}$') IS NOT TRUE
    OR jsonb_typeof(p_input->'planRevision') IS DISTINCT FROM 'number'
    OR (p_input->>'planRevision' ~ '^[1-9][0-9]*$') IS NOT TRUE
    OR (p_input ? 'reason' AND (jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
      OR length(btrim(p_input->>'reason')) = 0 OR length(p_input->>'reason') > 1000)) THEN
    RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || u::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || u::text, 0));
  SELECT b.* INTO primary_plan FROM public.training_blocks b
    WHERE b.user_id = u AND EXISTS (
      SELECT 1 FROM public.swim_conditioning_bindings link
      JOIN public.swim_workouts w ON w.id = link.swim_workout_id AND w.user_id = link.user_id
      WHERE link.block_id = b.id AND link.user_id = u AND w.plan_id = (p_input->>'planId')::uuid
    ) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO plan FROM public.swim_plans WHERE id = (p_input->>'planId')::uuid AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT value INTO prior FROM jsonb_array_elements(COALESCE(plan.state->'conditioningChanges','[]'::jsonb))
    WHERE value->>'id' = p_request_id::text;
  IF FOUND THEN
    IF prior->'input' IS DISTINCT FROM p_input THEN
      RAISE EXCEPTION 'CONDITIONING_REQUEST_REUSED' USING ERRCODE = '22023';
    END IF;
    RETURN p_request_id;
  END IF;
  IF plan.revision IS DISTINCT FROM (p_input->>'planRevision')::integer
    OR primary_plan.status <> 'active' OR primary_plan.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CONDITIONING_PLAN_CHANGED' USING ERRCODE = '40001';
  END IF;
  SELECT (now() AT TIME ZONE COALESCE(timezone,'UTC'))::date INTO today
    FROM public.profiles WHERE id = u;
  today := COALESCE(today, (now() AT TIME ZONE 'UTC')::date);
  monday := primary_plan.started_on - (extract(isodow FROM primary_plan.started_on)::integer - 1);
  IF command IN ('pause','resume','finish') THEN
    IF p_input ?| ARRAY['workoutId','workoutRevision','date','warnings'] OR NOT (
      (command IN ('pause','finish') AND plan.status = 'active') OR
      (command IN ('resume','finish') AND plan.status = 'paused')
    ) THEN RAISE EXCEPTION 'CONDITIONING_PLAN_CHANGED' USING ERRCODE = '40001'; END IF;
    IF command = 'resume' THEN
      PERFORM public.swim_conditioning_check_safety(plan.id, NULL);
    END IF;
    UPDATE public.swim_plans SET status = CASE command WHEN 'pause' THEN 'paused'
      WHEN 'resume' THEN 'active' ELSE 'finished' END,
      state = jsonb_set(state, '{lifecycle}', COALESCE(state->'lifecycle','[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('from',plan.status,'to',
          CASE command WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'active' ELSE 'finished' END,
          'recordedAt',now()))) WHERE id = plan.id;
  ELSE
    IF plan.status <> 'active'
      OR (p_input->>'workoutId' ~ '^[0-9a-f-]{36}$') IS NOT TRUE
      OR jsonb_typeof(p_input->'workoutRevision') IS DISTINCT FROM 'number'
      OR (p_input->>'workoutRevision' ~ '^[1-9][0-9]*$') IS NOT TRUE THEN
      RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
    END IF;
    SELECT w.* INTO work FROM public.swim_workouts w
      WHERE w.id = (p_input->>'workoutId')::uuid AND w.plan_id = plan.id AND w.user_id = u FOR UPDATE;
    SELECT p.* INTO planned FROM public.planned_sessions p
      JOIN public.swim_conditioning_bindings link ON link.planned_session_id = p.id AND link.user_id = p.user_id
      WHERE link.swim_workout_id = work.id AND p.user_id = u AND p.block_id = primary_plan.id FOR UPDATE OF p;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
    SELECT metadata->'outcome' INTO latest_outcome FROM public.swim_import_outcomes
      WHERE user_id = u AND workout_id = work.id ORDER BY revision DESC LIMIT 1;
    IF work.revision IS DISTINCT FROM (p_input->>'workoutRevision')::integer
      OR work.session_id IS NOT NULL OR COALESCE(latest_outcome <> 'null'::jsonb, false)
      OR work.status IS DISTINCT FROM (CASE WHEN command = 'unskip' THEN 'skipped' ELSE 'scheduled' END) THEN
      RAISE EXCEPTION 'CONDITIONING_WORKOUT_CHANGED' USING ERRCODE = '40001';
    END IF;
    IF command = 'move' THEN
      IF (p_input->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE
        OR NOT (p_input ? 'reason') OR jsonb_typeof(p_input->'warnings') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
      END IF;
      IF jsonb_array_length(p_input->'warnings') > 2 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_input->'warnings') warning
        WHERE jsonb_typeof(warning) <> 'string' OR length(warning::text) > 162
      ) THEN RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023'; END IF;
      target := (p_input->>'date')::date;
      IF work.scheduled_date <= today OR target <= today OR target < primary_plan.started_on
        OR target < plan.started_on OR target > plan.ends_on
        OR target = work.scheduled_date
        OR target NOT BETWEEN monday AND monday + primary_plan.weeks * 7 - 1 THEN
        RAISE EXCEPTION 'CONDITIONING_DATE_OUTSIDE_PROGRAM' USING ERRCODE = '22023';
      END IF;
      PERFORM public.swim_conditioning_check_safety(plan.id, work.id);
      IF EXISTS (SELECT 1 FROM public.planned_sessions p WHERE p.user_id = u AND p.block_id = primary_plan.id
        AND p.id <> planned.id AND p.week_index = (target - monday) / 7
        AND p.day_index = (target - monday) % 7 AND p.slot = planned.slot) THEN
        RAISE EXCEPTION 'CONDITIONING_DATE_OCCUPIED' USING ERRCODE = '22023';
      END IF;
      UPDATE public.planned_sessions SET week_index = (target - monday) / 7,
        day_index = (target - monday) % 7, planned_at = NULL WHERE id = planned.id;
      UPDATE public.swim_workouts SET scheduled_date = target WHERE id = work.id;
    ELSE
      IF p_input ?| ARRAY['date','warnings'] OR (command = 'skip' AND NOT (p_input ? 'reason')) THEN
        RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
      END IF;
      UPDATE public.swim_workouts SET status = CASE WHEN command = 'skip' THEN 'skipped' ELSE 'scheduled' END,
        definition = CASE WHEN command = 'skip' THEN jsonb_set(definition,'{skip}',
          jsonb_build_object('reason',p_input->>'reason','recordedAt',now())) ELSE definition - 'skip' END
        WHERE id = work.id;
    END IF;
    UPDATE public.swim_workouts SET revision = revision + 1, updated_at = now() WHERE id = work.id;
  END IF;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now(),
    state = jsonb_set(state,'{conditioningChanges}',COALESCE(state->'conditioningChanges','[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object('id',p_request_id,'input',p_input,'recordedAt',now(),
        'previousDate',work.scheduled_date,'previousStatus',plan.status,'ruleVersion','conditioning-lifecycle-1')))
    WHERE id = plan.id;
  RETURN p_request_id;
END $$;
GRANT CREATE ON SCHEMA public TO conditioning_writer;
ALTER FUNCTION public.swim_change_conditioning(uuid,jsonb) OWNER TO conditioning_writer;
REVOKE CREATE ON SCHEMA public FROM conditioning_writer;
REVOKE ALL ON FUNCTION public.swim_change_conditioning(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_change_conditioning(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.swim_conditioning_end_with_program()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || NEW.user_id::text, 0));
    UPDATE public.swim_plans sp SET status = 'finished', revision = revision + 1, updated_at = now(),
      state = jsonb_set(state,'{lifecycle}',COALESCE(state->'lifecycle','[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('from',sp.status,'to','finished',
          'recordedAt',now(),'blockId',NEW.id)))
      WHERE sp.user_id = NEW.user_id AND sp.status IN ('active','paused') AND EXISTS (
        SELECT 1 FROM public.swim_conditioning_bindings link
        JOIN public.swim_workouts w ON w.id = link.swim_workout_id AND w.user_id = link.user_id
        WHERE link.user_id = NEW.user_id AND link.block_id = NEW.id AND w.plan_id = sp.id
      );
  END IF;
  RETURN NEW;
END $$;
GRANT CREATE ON SCHEMA public TO conditioning_writer;
ALTER FUNCTION public.swim_conditioning_end_with_program() OWNER TO conditioning_writer;
REVOKE CREATE ON SCHEMA public FROM conditioning_writer;
REVOKE ALL ON FUNCTION public.swim_conditioning_end_with_program() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER swim_conditioning_end_with_program AFTER UPDATE OF status ON public.training_blocks
FOR EACH ROW EXECUTE FUNCTION public.swim_conditioning_end_with_program();
