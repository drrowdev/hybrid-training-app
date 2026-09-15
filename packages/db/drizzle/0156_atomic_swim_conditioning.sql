-- ADR0086: one programme save, retained workout identities and replay receipts.
CREATE ROLE conditioning_writer NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, auth TO conditioning_writer;
DO $$ BEGIN EXECUTE format('GRANT conditioning_writer TO %I', current_user); END $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO conditioning_writer;
GRANT SELECT, INSERT, UPDATE ON public.training_blocks, public.planned_sessions,
  public.program_instances TO conditioning_writer;
GRANT SELECT, INSERT, UPDATE ON public.training_maxes TO conditioning_writer;
GRANT SELECT (id, user_id) ON public.movements TO conditioning_writer;
GRANT SELECT (id, timezone) ON public.profiles TO conditioning_writer;
GRANT SELECT ON public.swim_plans, public.swim_workouts,
  public.swim_import_outcomes TO conditioning_writer;
-- PostgreSQL row locks require UPDATE on at least one column, even without a write.
GRANT UPDATE (revision) ON public.swim_plans, public.swim_workouts TO conditioning_writer;
GRANT EXECUTE ON FUNCTION public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb),
  public.swim_create_plan(date,date,jsonb,jsonb,jsonb) TO conditioning_writer;

ALTER TABLE public.training_blocks ADD CONSTRAINT conditioning_blocks_owner_id_key UNIQUE (user_id, id);
ALTER TABLE public.planned_sessions ADD CONSTRAINT conditioning_sessions_owner_id_key UNIQUE (user_id, id);
ALTER TABLE public.program_instances ADD CONSTRAINT conditioning_instances_owner_id_key UNIQUE (user_id, id);

CREATE TABLE public.swim_conditioning_bindings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  planned_session_id uuid UNIQUE,
  swim_workout_id uuid PRIMARY KEY,
  block_id uuid,
  metadata jsonb NOT NULL CONSTRAINT swim_conditioning_bindings_metadata_check CHECK ((
    jsonb_typeof(metadata) = 'object' AND metadata->'version' = '1'::jsonb
    AND jsonb_typeof(metadata->'workoutRevision') = 'number'
    AND metadata->>'workoutRevision' ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(metadata->'plannedPrescription') = 'object'
    AND metadata->>'plannedSessionId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND metadata->>'blockId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (planned_session_id IS NULL OR metadata->>'plannedSessionId' = planned_session_id::text)
    AND (block_id IS NULL OR metadata->>'blockId' = block_id::text)
    AND metadata - ARRAY['version','workoutRevision','plannedPrescription','plannedSessionId','blockId'] = '{}'::jsonb
  ) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swim_conditioning_bindings_session_fkey FOREIGN KEY (planned_session_id)
    REFERENCES public.planned_sessions(id) ON DELETE SET NULL,
  CONSTRAINT swim_conditioning_bindings_block_fkey FOREIGN KEY (block_id)
    REFERENCES public.training_blocks(id) ON DELETE SET NULL,
  CONSTRAINT swim_conditioning_bindings_owned_session_fkey FOREIGN KEY (user_id, planned_session_id) REFERENCES public.planned_sessions(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_conditioning_bindings_owned_workout_fkey FOREIGN KEY (user_id, swim_workout_id) REFERENCES public.swim_workouts(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_conditioning_bindings_owned_block_fkey FOREIGN KEY (user_id, block_id) REFERENCES public.training_blocks(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX swim_conditioning_bindings_owner_block ON public.swim_conditioning_bindings(user_id, block_id);

CREATE TABLE public.swim_conditioning_saves (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  block_id uuid,
  program_instance_id uuid,
  swim_plan_id uuid NOT NULL,
  metadata jsonb NOT NULL CONSTRAINT swim_conditioning_saves_metadata_check CHECK ((
    jsonb_typeof(metadata) = 'object'
    AND metadata->>'fingerprint' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(metadata->'skipped') = 'number'
    AND metadata->>'skipped' ~ '^(0|[1-9][0-9]*)$'
    AND metadata - ARRAY['fingerprint','skipped'] = '{}'::jsonb
  ) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id),
  CONSTRAINT swim_conditioning_saves_block_fkey FOREIGN KEY (block_id)
    REFERENCES public.training_blocks(id) ON DELETE SET NULL,
  CONSTRAINT swim_conditioning_saves_instance_fkey FOREIGN KEY (program_instance_id)
    REFERENCES public.program_instances(id) ON DELETE SET NULL,
  CONSTRAINT swim_conditioning_saves_owned_block_fkey FOREIGN KEY (user_id, block_id) REFERENCES public.training_blocks(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_conditioning_saves_owned_instance_fkey FOREIGN KEY (user_id, program_instance_id) REFERENCES public.program_instances(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_conditioning_saves_owned_swim_fkey FOREIGN KEY (user_id, swim_plan_id) REFERENCES public.swim_plans(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.swim_conditioning_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swim_conditioning_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_conditioning_bindings_owner ON public.swim_conditioning_bindings
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY swim_conditioning_saves_owner ON public.swim_conditioning_saves
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.swim_conditioning_bindings, public.swim_conditioning_saves
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_conditioning_bindings, public.swim_conditioning_saves TO authenticated;
GRANT SELECT, INSERT ON public.swim_conditioning_bindings, public.swim_conditioning_saves TO conditioning_writer;

CREATE FUNCTION public.swim_conditioning_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$ SELECT true $$;

-- One statement observes the binding, current claim and current recording together.
CREATE VIEW public.swim_conditioning_sessions WITH (security_invoker = true) AS
SELECT link.user_id, link.planned_session_id, link.block_id,
  w.id, w.plan_id, w.revision, w.status, w.session_id, w.scheduled_date, w.slot, w.definition,
  sp.status AS plan_status, sp.revision AS plan_revision,
  b.status AS block_status, b.deleted_at AS block_deleted_at,
  logged.id AS visible_session_id, logged.completed_at AS native_completed_at,
  o.match_id AS outcome_match_id, o.metadata AS outcome_metadata,
  m.id AS current_match_id, m.import_id AS matched_import_id,
  (m.metadata#>>'{workout,revision}')::integer AS matched_workout_revision,
  latest.id AS latest_import_id, latest.evidence->>'date' AS recording_date
FROM public.swim_conditioning_bindings link
JOIN public.swim_workouts w ON w.id = link.swim_workout_id AND w.user_id = link.user_id
JOIN public.swim_plans sp ON sp.id = w.plan_id AND sp.user_id = link.user_id
LEFT JOIN public.planned_sessions p ON p.id = link.planned_session_id AND p.user_id = link.user_id
LEFT JOIN public.training_blocks b ON b.id = p.block_id AND b.user_id = link.user_id
LEFT JOIN public.sessions logged ON logged.id = w.session_id AND logged.user_id = link.user_id AND logged.deleted_at IS NULL
LEFT JOIN public.swim_current_import_outcomes o ON o.workout_id = w.id AND o.user_id = link.user_id
LEFT JOIN public.swim_current_import_matches m ON m.id = o.match_id AND m.workout_id = w.id AND m.user_id = link.user_id
LEFT JOIN LATERAL (
  SELECT i.id, i.evidence FROM public.swim_imports i
  WHERE i.user_id = link.user_id AND i.activity_id = m.activity_id
  ORDER BY i.revision DESC LIMIT 1
) latest ON true;
REVOKE ALL ON public.swim_conditioning_sessions FROM PUBLIC, anon, service_role;
GRANT SELECT ON public.swim_conditioning_sessions TO authenticated;

CREATE FUNCTION public.swim_conditioning_benchmarks_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.swim_conditioning_benchmarks_ready() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.swim_conditioning_benchmarks_ready() TO authenticated;

CREATE FUNCTION public.swim_conditioning_replay(p_request_id uuid, p_request_input jsonb)
RETURNS TABLE(block_id uuid, program_instance_id uuid, swim_plan_id uuid, skipped integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE receipt public.swim_conditioning_saves;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO receipt FROM public.swim_conditioning_saves
    WHERE user_id = auth.uid() AND request_id = p_request_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF receipt.metadata->>'fingerprint' IS DISTINCT FROM
    encode(sha256(convert_to(p_request_input::text, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'CONDITIONING_REQUEST_REUSED' USING ERRCODE = '22023';
  END IF;
  IF receipt.block_id IS NULL OR receipt.program_instance_id IS NULL THEN
    RAISE EXCEPTION 'CONDITIONING_SAVED_PLAN_REMOVED' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT receipt.block_id, receipt.program_instance_id, receipt.swim_plan_id,
    (receipt.metadata->>'skipped')::integer;
END $$;

CREATE FUNCTION public.deploy_program_with_swimming(
  p_request_id uuid, p_request_input jsonb, p_block jsonb, p_planned_sessions jsonb,
  p_tm_percents jsonb, p_program_instance jsonb, p_swim jsonb
)
RETURNS TABLE(block_id uuid, program_instance_id uuid, swim_plan_id uuid, skipped integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  u uuid := auth.uid();
  fingerprint text;
  swim public.swim_plans;
  workout public.swim_workouts;
  planned public.planned_sessions;
  saved_block uuid;
  saved_instance uuid;
  saved_swim_id uuid;
  saved_skipped integer;
  saved_swim jsonb;
  zone text;
  today date;
  monday date;
  linked integer := 0;
  benchmarks jsonb;
  benchmark jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_request_input) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_block) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_program_instance) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_planned_sessions) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_swim) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  -- Replay the caller's unchanged intent, not a newly recomputed engine snapshot.
  fingerprint := encode(sha256(convert_to(p_request_input::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  SELECT r.block_id, r.program_instance_id, r.swim_plan_id, r.skipped
    INTO saved_block, saved_instance, saved_swim_id, saved_skipped
    FROM public.swim_conditioning_replay(p_request_id, p_request_input) r;
  IF FOUND THEN
    RETURN QUERY SELECT saved_block, saved_instance, saved_swim_id, saved_skipped;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || u::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || u::text, 0));
  SELECT timezone INTO zone FROM public.profiles WHERE id = u;
  today := (now() AT TIME ZONE COALESCE(zone, 'UTC'))::date;
  saved_skipped := (p_program_instance#>>'{setup_input,conditioning,skipped}')::integer;
  IF saved_skipped IS NULL OR saved_skipped < 0 THEN
    RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  benchmarks := COALESCE(p_request_input#>'{conditioning,benchmarks}', '[]'::jsonb);
  IF jsonb_typeof(benchmarks) IS DISTINCT FROM 'array' OR jsonb_array_length(benchmarks) > 64 THEN
    RAISE EXCEPTION 'CONDITIONING_INVALID_BENCHMARKS' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT entry->>'movementId') FROM jsonb_array_elements(benchmarks) entry)
     <> jsonb_array_length(benchmarks) THEN
    RAISE EXCEPTION 'CONDITIONING_INVALID_BENCHMARKS' USING ERRCODE = '22023';
  END IF;
  FOR benchmark IN SELECT value FROM jsonb_array_elements(benchmarks) ORDER BY value->>'movementId'
  LOOP
    IF jsonb_typeof(benchmark) IS DISTINCT FROM 'object'
       OR benchmark - ARRAY['movementId','oneRmKg'] <> '{}'::jsonb
       OR (benchmark->>'movementId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
       OR jsonb_typeof(benchmark->'oneRmKg') IS DISTINCT FROM 'number'
       OR (benchmark->>'oneRmKg')::numeric <= 0 OR (benchmark->>'oneRmKg')::numeric > 1000 THEN
      RAISE EXCEPTION 'CONDITIONING_INVALID_BENCHMARKS' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.movements
      WHERE id = (benchmark->>'movementId')::uuid AND (user_id IS NULL OR user_id = u)) THEN
      RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.training_maxes(user_id, movement_id, one_rm_kg, tm_percent, source)
      VALUES (u, (benchmark->>'movementId')::uuid, (benchmark->>'oneRmKg')::numeric,
        (p_program_instance#>>'{setup_input,conditioning,benchmarkTmPercent}')::numeric, 'entered')
      ON CONFLICT (user_id, movement_id) DO UPDATE SET
        one_rm_kg = EXCLUDED.one_rm_kg, source = 'entered',
        derived_from_session_id = NULL, derived_from_set_log_id = NULL,
        derived_formula = NULL, derived_at = NULL;
  END LOOP;
  SELECT d.block_id, d.program_instance_id INTO saved_block, saved_instance
    FROM public.deploy_program_instance_atomically(
      p_block, p_planned_sessions, p_tm_percents, p_program_instance
    ) AS d;

  IF p_swim ? 'plan_id' THEN
    IF p_swim - ARRAY['plan_id','expected_revision'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO swim FROM public.swim_plans
      WHERE id = (p_swim->>'plan_id')::uuid AND user_id = u FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONDITIONING_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
    IF swim.revision IS DISTINCT FROM (p_swim->>'expected_revision')::integer
       OR swim.status <> 'active' THEN
      RAISE EXCEPTION 'CONDITIONING_PLAN_CHANGED' USING ERRCODE = '40001';
    END IF;
  ELSE
    IF p_swim - ARRAY['started_on','ends_on','definition','state','workouts'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'CONDITIONING_INVALID_REQUEST' USING ERRCODE = '22023';
    END IF;
    IF (p_swim->>'started_on')::date < today THEN
      RAISE EXCEPTION 'CONDITIONING_COURSE_DOES_NOT_FIT' USING ERRCODE = '22023';
    END IF;
    saved_swim := public.swim_create_plan(
      (p_swim->>'started_on')::date, (p_swim->>'ends_on')::date,
      p_swim->'definition', p_swim->'state', p_swim->'workouts'
    );
    SELECT * INTO STRICT swim FROM public.swim_plans
      WHERE id = (saved_swim->'plan'->>'id')::uuid AND user_id = u;
  END IF;
  SELECT b.started_on - (extract(isodow FROM b.started_on)::integer - 1)
    INTO monday FROM public.training_blocks b WHERE b.id = saved_block AND b.user_id = u;
  FOR workout IN SELECT * FROM public.swim_workouts
    WHERE user_id = u AND plan_id = swim.id AND scheduled_date >= today ORDER BY id FOR UPDATE
  LOOP
    IF workout.status <> 'scheduled' OR workout.session_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.swim_conditioning_bindings WHERE swim_workout_id = workout.id)
       OR (SELECT o.metadata->>'outcome' FROM public.swim_import_outcomes o
         WHERE o.user_id = u AND o.workout_id = workout.id ORDER BY o.revision DESC LIMIT 1) IS NOT NULL THEN
      RAISE EXCEPTION 'CONDITIONING_WORKOUT_CHANGED' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO planned FROM public.planned_sessions p
      WHERE p.user_id = u AND p.block_id = saved_block
        AND monday + p.week_index * 7 + p.day_index = workout.scheduled_date
        AND p.slot = workout.slot FOR UPDATE;
    IF NOT FOUND OR planned.role <> 'cardio'
       OR planned.completed_session_id IS NOT NULL OR planned.skipped_at IS NOT NULL
       OR jsonb_array_length(planned.prescription->'items') IS DISTINCT FROM 1
       OR planned.prescription->'items'->0->>'kind' IS DISTINCT FROM 'cardio_external' THEN
      RAISE EXCEPTION 'CONDITIONING_COURSE_DOES_NOT_FIT' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_request_input#>'{conditioning,choices}') choice
      WHERE (choice->>'weekday')::integer = planned.day_index AND choice->>'activity' = 'swimming') THEN
      RAISE EXCEPTION 'CONDITIONING_COURSE_DOES_NOT_FIT' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.swim_conditioning_bindings(user_id, planned_session_id, swim_workout_id, block_id, metadata)
      VALUES (u, planned.id, workout.id, saved_block, jsonb_build_object(
        'version', 1, 'workoutRevision', workout.revision, 'plannedPrescription', planned.prescription,
        'plannedSessionId', planned.id, 'blockId', saved_block));
    linked := linked + 1;
  END LOOP;
  IF linked = 0 THEN RAISE EXCEPTION 'CONDITIONING_NO_UPCOMING_SWIMS' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.swim_conditioning_saves(user_id, request_id, block_id, program_instance_id, swim_plan_id, metadata)
    VALUES (u, p_request_id, saved_block, saved_instance, swim.id,
      jsonb_build_object('fingerprint', fingerprint, 'skipped', saved_skipped));
  RETURN QUERY SELECT saved_block, saved_instance, swim.id, saved_skipped;
END $$;

-- Legacy rewrites cannot detach a swim, change its date alone or log it twice.
CREATE FUNCTION public.check_swim_conditioning_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Wait until all cascades finish: parent purge is allowed, a live-slot rewrite is not.
    IF EXISTS (
      SELECT 1 FROM public.swim_conditioning_bindings link
      JOIN public.training_blocks b ON b.id = link.block_id AND b.user_id = link.user_id
      WHERE link.user_id = OLD.user_id AND link.metadata->>'plannedSessionId' = OLD.id::text
    ) THEN
      RAISE EXCEPTION 'CONDITIONING_LINK_CHANGED' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.swim_conditioning_bindings link
    JOIN public.planned_sessions p ON p.id = link.planned_session_id AND p.user_id = link.user_id
    JOIN public.training_blocks b ON b.id = link.block_id AND b.user_id = link.user_id
    JOIN public.swim_workouts w ON w.id = link.swim_workout_id AND w.user_id = link.user_id
    WHERE link.user_id = COALESCE(NEW.user_id, OLD.user_id)
      AND (p.block_id <> link.block_id OR p.role <> 'cardio' OR p.week_index >= b.weeks
        OR p.completed_session_id IS NOT NULL OR p.skipped_at IS NOT NULL
        OR (CASE WHEN jsonb_typeof(p.prescription->'items') = 'array'
          THEN jsonb_array_length(p.prescription->'items') = 1
            AND p.prescription->'items'->0->>'kind' = 'cardio_external'
          ELSE false END) IS NOT TRUE
        OR p.slot <> w.slot
        OR b.started_on - (extract(isodow FROM b.started_on)::integer - 1)
          + p.week_index * 7 + p.day_index <> w.scheduled_date)
  ) THEN
    RAISE EXCEPTION 'CONDITIONING_LINK_CHANGED' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER swim_conditioning_primary_consistency
  AFTER UPDATE OR DELETE ON public.planned_sessions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_swim_conditioning_binding();
CREATE CONSTRAINT TRIGGER swim_conditioning_workout_consistency
  AFTER UPDATE ON public.swim_workouts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_swim_conditioning_binding();
CREATE CONSTRAINT TRIGGER swim_conditioning_block_consistency
  AFTER UPDATE ON public.training_blocks DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_swim_conditioning_binding();

GRANT CREATE ON SCHEMA public TO conditioning_writer;
ALTER FUNCTION public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) OWNER TO conditioning_writer;
ALTER FUNCTION public.check_swim_conditioning_binding() OWNER TO conditioning_writer;
REVOKE CREATE ON SCHEMA public FROM conditioning_writer;
REVOKE ALL ON FUNCTION public.swim_conditioning_ready(),
  public.swim_conditioning_replay(uuid,jsonb),
  public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb),
  public.check_swim_conditioning_binding() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_conditioning_ready(),
  public.swim_conditioning_replay(uuid,jsonb),
  public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swim_conditioning_replay(uuid,jsonb) TO conditioning_writer;
