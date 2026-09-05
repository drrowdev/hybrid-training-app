-- ADR 0079, slice 1: independent swimming, ordinary sessions, native actuals.
-- No primary program/block/season rows or slot bindings are introduced.
-- A non-login, non-bypass role makes the RPC boundary unforgeable by a caller.
-- It is not a table owner, so the normal authenticated owner policies still apply.
CREATE ROLE swim_writer NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public, auth TO swim_writer;
GRANT EXECUTE ON FUNCTION auth.uid() TO swim_writer;
DO $$
BEGIN
  EXECUTE format('GRANT swim_writer TO %I', current_user);
END $$;


CREATE UNIQUE INDEX sessions_user_id_id_key ON public.sessions (user_id, id);

CREATE TABLE public.swim_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'finished', 'archived')),
  started_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= started_on),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  definition jsonb NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX swim_plans_one_active_per_user
  ON public.swim_plans (user_id) WHERE status = 'active';
CREATE INDEX swim_plans_owner_status_idx ON public.swim_plans (user_id, status);

CREATE TABLE public.swim_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  scheduled_date date NOT NULL,
  slot public.session_slot NOT NULL DEFAULT 'single',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'started', 'completed', 'skipped')),
  session_id uuid UNIQUE,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swim_workouts_owned_plan_fk FOREIGN KEY (user_id, plan_id)
    REFERENCES public.swim_plans (user_id, id) ON DELETE CASCADE,
  -- Retain prescription history on purge; never null out the non-null owner.
  CONSTRAINT swim_workouts_owned_session_fk FOREIGN KEY (user_id, session_id)
    REFERENCES public.sessions (user_id, id) ON DELETE SET NULL (session_id)
);
CREATE INDEX swim_workouts_owner_date_idx
  ON public.swim_workouts (user_id, scheduled_date, id);
CREATE INDEX swim_workouts_plan_idx ON public.swim_workouts (plan_id, scheduled_date);
CREATE TRIGGER swim_plans_set_updated_at BEFORE UPDATE ON public.swim_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER swim_workouts_set_updated_at BEFORE UPDATE ON public.swim_workouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.swim_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swim_workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_plans_owner ON public.swim_plans
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY swim_workouts_owner ON public.swim_workouts
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.swim_plans, public.swim_workouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.swim_plans, public.swim_workouts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.swim_plans, public.swim_workouts TO swim_writer;
GRANT SELECT, INSERT, UPDATE ON public.sessions, public.cardio_logs TO swim_writer;
GRANT SELECT ON public.planned_sessions, public.set_logs, public.session_movements TO swim_writer;
GRANT SELECT (id, timezone) ON public.profiles TO swim_writer;
GRANT SELECT (user_id, region, affected_muscles, affected_movement_ids, allowed_movement_ids, resolved_at)
  ON public.limitations TO swim_writer;
GRANT SELECT (id, slug, user_id) ON public.movements TO swim_writer;
GRANT EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid, text, uuid)
  TO swim_writer;

ALTER TABLE public.cardio_logs ADD COLUMN swim_result jsonb;
CREATE UNIQUE INDEX cardio_logs_one_swim_result_per_session
  ON public.cardio_logs (session_id) WHERE swim_result IS NOT NULL;
COMMENT ON COLUMN public.cardio_logs.swim_result IS
  'ADR0079 exact native whole-length/time result. Generic distance/time are rounded projections only.';

CREATE FUNCTION public.swim_storage_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.swim_storage_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swim_storage_ready() TO authenticated;

CREATE FUNCTION public.swim_bounded_integer(p_value jsonb, p_min bigint, p_max bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_value numeric;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Swimming requires an integer value.';
  END IF;
  v_value := (p_value #>> '{}')::numeric;
  IF v_value <> trunc(v_value) OR v_value < p_min OR v_value > p_max THEN
    RAISE EXCEPTION 'Swimming integer is outside its supported bounds.';
  END IF;
  RETURN v_value::bigint;
END $$;

CREATE FUNCTION public.swim_local_today()
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.profiles WHERE id = auth.uid()), 'UTC'
  ))::date
$$;

CREATE FUNCTION public.swim_array_append_only(p_old jsonb, p_new jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_index integer;
BEGIN
  IF jsonb_typeof(p_old) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_new) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_new) < jsonb_array_length(p_old) THEN RETURN false; END IF;
  FOR v_index IN 0..jsonb_array_length(p_old) - 1 LOOP
    IF p_old->v_index IS DISTINCT FROM p_new->v_index THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION public.swim_validate_course(p_course jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_n bigint; v_d bigint; v_a bigint; v_b bigint; v_rem bigint;
BEGIN
  v_n := public.swim_bounded_integer(p_course->'numerator', 1, 1000000);
  v_d := public.swim_bounded_integer(p_course->'denominator', 1, 10000);
  IF p_course->>'unit' IS NULL OR p_course->>'unit' NOT IN ('m','yd')
     OR v_n < 5 * v_d OR v_n > 100 * v_d THEN
    RAISE EXCEPTION 'Unsupported pool course.';
  END IF;
  v_a := v_n; v_b := v_d;
  WHILE v_b <> 0 LOOP v_rem := v_a % v_b; v_a := v_b; v_b := v_rem; END LOOP;
  IF v_a <> 1 THEN RAISE EXCEPTION 'Pool course must be a reduced positive rational.'; END IF;
END $$;

CREATE FUNCTION public.swim_validate_labels(p_values jsonb, p_allowed text[], p_nonempty boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_values) > cardinality(p_allowed)
     OR (p_nonempty AND jsonb_array_length(p_values) = 0) THEN
    RAISE EXCEPTION 'Invalid swimming category snapshot.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_values) value
    WHERE jsonb_typeof(value) <> 'string' OR NOT ((value #>> '{}') = ANY(p_allowed)))
     OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements(p_values)) THEN
    RAISE EXCEPTION 'Invalid swimming category labels.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_snapshot(p_snapshot jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.swim_validate_course(p_snapshot->'course');
  PERFORM public.swim_validate_labels(p_snapshot->'strokes',
    ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
  PERFORM public.swim_validate_labels(p_snapshot->'equipment',
    ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
  IF NULLIF(p_snapshot->'versions'->>'model', '') IS NULL
     OR NULLIF(p_snapshot->'versions'->>'generator', '') IS NULL
     OR NOT (p_snapshot->'versions' ? 'assessment')
     OR NOT (p_snapshot ? 'protocol') OR NOT (p_snapshot ? 'calibration')
     OR (p_snapshot->>'protocol' IS NOT NULL AND p_snapshot->>'protocol' <> 'css_200_400') THEN
    RAISE EXCEPTION 'Swimming snapshot versions or protocol are missing.';
  END IF;
  IF p_snapshot->'calibration' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_snapshot->'calibration'->'msPer100') IS DISTINCT FROM 'number'
       OR (p_snapshot->'calibration'->>'msPer100')::numeric NOT BETWEEN 30000 AND 600000
       OR p_snapshot->'calibration'->>'unit' IS DISTINCT FROM p_snapshot->'course'->>'unit'
       OR p_snapshot->'calibration'->>'protocol' IS DISTINCT FROM 'css_200_400'
       OR p_snapshot->'calibration'->'heuristic' IS DISTINCT FROM 'true'::jsonb
       OR p_snapshot->'calibration'->>'version' IS DISTINCT FROM 'swim-css-1'
       OR p_snapshot->'versions'->>'assessment' IS DISTINCT FROM 'swim-css-1'
       OR NULLIF(p_snapshot->'calibration'->>'observedOn', '') IS NULL
       OR p_snapshot->>'protocol' IS DISTINCT FROM 'css_200_400' THEN
      RAISE EXCEPTION 'Invalid swimming calibration snapshot.';
    END IF;
    PERFORM (p_snapshot->'calibration'->>'observedOn')::date;
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_prescription(p_workout jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_section jsonb; v_item jsonb; v_total bigint := 0; v_rounds bigint;
  v_order integer := 0; v_next integer; v_kinds text[] := ARRAY[]::text[];
  v_strokes text[] := ARRAY[]::text[]; v_equipment text[] := ARRAY[]::text[];
BEGIN
  IF p_workout->>'kind' IS DISTINCT FROM 'swim_workout'
     OR p_workout->>'focus' IS NULL
     OR p_workout->>'focus' NOT IN ('technique_base','endurance','event_specific')
     OR jsonb_typeof(p_workout->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_workout->'sections') NOT BETWEEN 3 AND 20 THEN
    RAISE EXCEPTION 'Invalid swimming prescription.';
  END IF;
  PERFORM public.swim_validate_snapshot(p_workout->'snapshot');
  PERFORM public.swim_bounded_integer(p_workout->'budget'->'minutes', 1, 240);
  PERFORM public.swim_bounded_integer(p_workout->'budget'->'accountedMs', 0, 86400000);
  IF NOT (p_workout ? 'estimatedMs') THEN RAISE EXCEPTION 'Invalid swimming budget.'; END IF;
  IF p_workout->'estimatedMs' <> 'null'::jsonb THEN
    PERFORM public.swim_bounded_integer(p_workout->'estimatedMs', 1, 86400000);
    IF p_workout->'snapshot'->'calibration' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Uncalibrated swimming cannot claim an estimated duration.';
    END IF;
    IF p_workout->'estimatedMs' IS DISTINCT FROM p_workout->'budget'->'accountedMs' THEN
      RAISE EXCEPTION 'Swimming duration must match its timed work.';
    END IF;
  END IF;
  FOR v_section IN SELECT value FROM jsonb_array_elements(p_workout->'sections') LOOP
    v_next := array_position(ARRAY['warmup','preparation','main','recovery','cooldown'], v_section->>'kind');
    IF v_next IS NULL OR v_next < v_order
       OR jsonb_typeof(v_section->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_section->'items') NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Invalid swimming sections.';
    END IF;
    v_order := v_next; v_kinds := array_append(v_kinds, v_section->>'kind');
    v_rounds := public.swim_bounded_integer(v_section->'rounds', 1, 2000);
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_section->'items') LOOP
      v_total := v_total + v_rounds
        * public.swim_bounded_integer(v_item->'repeats', 1, 2000)
        * public.swim_bounded_integer(v_item->'lengths', 1, 2000);
      IF v_total > 2000 THEN RAISE EXCEPTION 'Swimming prescription exceeds its length limit.'; END IF;
      PERFORM public.swim_validate_labels(jsonb_build_array(v_item->'stroke'),
        ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
      PERFORM public.swim_validate_labels(v_item->'equipment',
        ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
      v_strokes := array_append(v_strokes, v_item->>'stroke');
      v_equipment := v_equipment || ARRAY(SELECT jsonb_array_elements_text(v_item->'equipment'));
      IF v_item->>'effort' IS NULL OR v_item->>'effort' NOT IN ('easy','steady','brisk','threshold','sprint')
         OR jsonb_typeof(v_item->'optional') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Invalid swimming effort.';
      END IF;
      IF v_item ? 'targetMsPerRepeat' THEN
        PERFORM public.swim_bounded_integer(v_item->'targetMsPerRepeat', 1, 86400000);
        IF p_workout->'snapshot'->'calibration' = 'null'::jsonb THEN
          RAISE EXCEPTION 'Swimming pace targets require a calibration.';
        END IF;
      END IF;
      IF v_item ? 'sendoffMs' THEN PERFORM public.swim_bounded_integer(v_item->'sendoffMs', 1, 86400000); END IF;
      IF v_item ? 'restSeconds' THEN PERFORM public.swim_bounded_integer(v_item->'restSeconds', 0, 86400); END IF;
    END LOOP;
  END LOOP;
  IF NOT (v_kinds @> ARRAY['warmup','main','cooldown'])
     OR v_total <> public.swim_bounded_integer(p_workout->'totalLengths', 1, 2000)
     OR (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(v_strokes) s)
        IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM jsonb_array_elements_text(p_workout->'snapshot'->'strokes') s)
     OR (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(v_equipment) s)
        IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM jsonb_array_elements_text(p_workout->'snapshot'->'equipment') s) THEN
    RAISE EXCEPTION 'Swimming totals or snapshot categories disagree with the prescription.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_observation(p_observation jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_trial jsonb; v_distances bigint[] := ARRAY[]::bigint[]; v_distance bigint; v_lengths bigint;
BEGIN
  PERFORM public.swim_validate_course(p_observation->'course');
  PERFORM public.swim_validate_labels(jsonb_build_array(p_observation->'stroke'),
    ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
  PERFORM public.swim_validate_labels(p_observation->'equipment',
    ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
  IF p_observation->>'protocol' IS DISTINCT FROM 'css_200_400'
     OR NULLIF(p_observation->>'version', '') IS NULL
     OR NULLIF(p_observation->>'observedOn', '') IS NULL
     OR jsonb_typeof(p_observation->'trials') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_observation->'trials') <> 2 THEN
    RAISE EXCEPTION 'Invalid swimming assessment observation.';
  END IF;
  PERFORM (p_observation->>'observedOn')::date;
  FOR v_trial IN SELECT value FROM jsonb_array_elements(p_observation->'trials') LOOP
    v_distance := public.swim_bounded_integer(v_trial->'distance', 200, 400);
    v_lengths := public.swim_bounded_integer(v_trial->'lengths', 1, 2000);
    PERFORM public.swim_bounded_integer(v_trial->'timeMs', 1, 86400000);
    IF v_distance NOT IN (200, 400)
       OR v_lengths * (p_observation->'course'->>'numerator')::numeric <>
          v_distance * (p_observation->'course'->>'denominator')::numeric THEN
      RAISE EXCEPTION 'Swimming assessment requires exact 200 and 400 whole-length distances.';
    END IF;
    v_distances := array_append(v_distances, v_distance);
  END LOOP;
  IF NOT (v_distances @> ARRAY[200,400]::bigint[]) THEN
    RAISE EXCEPTION 'Swimming assessment requires both distances.';
  END IF;
END $$;

-- Unverified and unsupported observations remain valid history. Only a
-- calibration used for pace must retain a verified, supported source observation.
CREATE FUNCTION public.swim_validate_verified_calibration(p_cal jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_t200 numeric; v_t400 numeric;
BEGIN
  PERFORM public.swim_validate_observation(p_cal->'observation');
  IF p_cal->'observation'->'verified' IS DISTINCT FROM 'true'::jsonb
     OR p_cal->>'version' IS DISTINCT FROM 'swim-css-1'
     OR p_cal->'observation'->>'version' IS DISTINCT FROM 'swim-css-1'
     OR jsonb_typeof(p_cal->'msPer100') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Swimming pace requires a verified supported observation.';
  END IF;
  SELECT (value->>'timeMs')::numeric INTO v_t200 FROM jsonb_array_elements(p_cal->'observation'->'trials')
    WHERE (value->>'distance')::numeric = 200;
  SELECT (value->>'timeMs')::numeric INTO v_t400 FROM jsonb_array_elements(p_cal->'observation'->'trials')
    WHERE (value->>'distance')::numeric = 400;
  -- Mirrors swim-css-1's heuristic plausibility guards, not a physiological limit.
  IF v_t400 <= v_t200 * 2 OR v_t400 >= v_t200 * 2.5
     OR (v_t400 - v_t200) / 2 NOT BETWEEN 30000 AND 600000
     OR (p_cal->>'msPer100')::numeric <> (v_t400 - v_t200) / 2 THEN
    RAISE EXCEPTION 'Swimming calibration disagrees with its native observations.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_plan(p_definition jsonb, p_state jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_entry jsonb; v_setup jsonb := p_definition->'setup'; v_cal jsonb := p_state->'acceptedCalibration';
BEGIN
  IF p_definition->'version' IS DISTINCT FROM '1'::jsonb
     OR p_state->'version' IS DISTINCT FROM '1'::jsonb
     OR NULLIF(p_definition->>'generatorVersion', '') IS NULL
     OR jsonb_typeof(p_state->'observations') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state->'decisions') IS DISTINCT FROM 'array'
     OR NOT (p_state ? 'acceptedCalibration') THEN
    RAISE EXCEPTION 'Invalid swimming plan or state version.';
  END IF;
  PERFORM public.swim_validate_course(v_setup->'course');
  PERFORM public.swim_validate_labels(v_setup->'knownStrokes',
    ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
  PERFORM public.swim_validate_labels(v_setup->'equipment',
    ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
  PERFORM public.swim_bounded_integer(v_setup->'recentComfortableLengths', 1, 2000);
  PERFORM public.swim_bounded_integer(v_setup->'sessionBudgetMinutes', 10, 240);
  IF v_setup->>'goal' IS NULL OR v_setup->>'goal' NOT IN ('technique_base','endurance')
     OR v_setup->>'experience' IS NULL
     OR v_setup->>'experience' NOT IN ('learning','returning','recreational','trained') THEN
    RAISE EXCEPTION 'Invalid swimming setup.';
  END IF;
  IF v_setup ? 'event' THEN
    IF jsonb_typeof(v_setup->'event'->'distance') IS DISTINCT FROM 'number'
       OR (v_setup->'event'->>'distance')::numeric <= 0
       OR (v_setup->'event'->>'distance')::numeric > 200000
       OR v_setup->'event'->>'unit' IS NULL OR v_setup->'event'->>'unit' NOT IN ('m','yd')
       OR NULLIF(v_setup->'event'->>'dateISO', '') IS NULL THEN RAISE EXCEPTION 'Invalid swimming event.'; END IF;
    PERFORM (v_setup->'event'->>'dateISO')::date;
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_state->'observations') LOOP
    PERFORM public.swim_validate_observation(v_entry);
  END LOOP;
  IF v_setup ? 'benchmarks' THEN
    IF jsonb_typeof(v_setup->'benchmarks') <> 'array' THEN RAISE EXCEPTION 'Invalid swimming benchmarks.'; END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_setup->'benchmarks') LOOP
      PERFORM public.swim_validate_observation(v_entry);
    END LOOP;
  END IF;
  IF v_cal <> 'null'::jsonb THEN
    PERFORM public.swim_validate_verified_calibration(v_cal);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'observations') WHERE value = v_cal->'observation')
       OR v_cal->'course' IS DISTINCT FROM v_cal->'observation'->'course'
       OR v_cal->'stroke' IS DISTINCT FROM v_cal->'observation'->'stroke'
       OR v_cal->'equipment' IS DISTINCT FROM v_cal->'observation'->'equipment'
       OR v_cal->'protocol' IS DISTINCT FROM v_cal->'observation'->'protocol'
       OR v_cal->>'unit' IS DISTINCT FROM v_cal->'course'->>'unit'
       OR v_cal->'heuristic' IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_cal->'msPer100') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Swimming calibration must retain its original observation.';
    END IF;
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_state->'decisions') LOOP
    IF NULLIF(v_entry->>'id', '') IS NULL OR NULLIF(v_entry->>'recordedAt', '') IS NULL
       OR NULLIF(v_entry->>'ruleVersion', '') IS NULL OR NULLIF(v_entry->>'generatorVersion', '') IS NULL
       OR v_entry->>'kind' IS NULL OR v_entry->>'kind' NOT IN ('progression','assessment','schedule','setup')
       OR v_entry->>'decision' IS NULL OR v_entry->>'decision' NOT IN ('accepted','rejected','overridden')
       OR jsonb_typeof(v_entry->'inputSnapshot') IS DISTINCT FROM 'object'
       OR (v_entry->>'decision' = 'overridden' AND NULLIF(btrim(v_entry->>'reason'), '') IS NULL) THEN
      RAISE EXCEPTION 'Swimming decisions require their input snapshot, versions and override reason.';
    END IF;
    PERFORM (v_entry->>'recordedAt')::timestamptz;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_state->'decisions')) THEN
    RAISE EXCEPTION 'Swimming decision IDs must be unique.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_state_append(p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.swim_array_append_only(p_old->'observations', p_new->'observations')
     OR NOT public.swim_array_append_only(p_old->'decisions', p_new->'decisions')
     OR p_old->'lifecycle' IS DISTINCT FROM p_new->'lifecycle'
     OR p_old->'pauseSnapshot' IS DISTINCT FROM p_new->'pauseSnapshot'
     OR jsonb_array_length(p_new->'decisions') <= jsonb_array_length(p_old->'decisions') THEN
    RAISE EXCEPTION 'Swimming changes must append to the decision history.';
  END IF;
  IF p_old->'acceptedCalibration' IS DISTINCT FROM p_new->'acceptedCalibration'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_new->'decisions') WITH ORDINALITY d(value, position)
       WHERE position > jsonb_array_length(p_old->'decisions')
         AND value->>'kind' = 'assessment' AND value->>'decision' IN ('accepted','overridden')
     ) THEN RAISE EXCEPTION 'Accept the swimming assessment before changing calibration.'; END IF;
END $$;

CREATE FUNCTION public.swim_validate_workout(p_definition jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_entry jsonb;
BEGIN
  IF p_definition->'version' IS DISTINCT FROM '1'::jsonb
     OR jsonb_typeof(p_definition->'modifications') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid swimming workout version or history.';
  END IF;
  PERFORM public.swim_validate_prescription(p_definition->'original');
  PERFORM public.swim_validate_prescription(p_definition->'issued');
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_definition->'modifications') LOOP
    IF NULLIF(v_entry->>'id', '') IS NULL OR NULLIF(v_entry->>'recordedAt', '') IS NULL
       OR NULLIF(btrim(v_entry->>'reason'), '') IS NULL OR NULLIF(v_entry->>'decisionId', '') IS NULL THEN
      RAISE EXCEPTION 'Swimming modifications require a decision and reason.';
    END IF;
    PERFORM (v_entry->>'recordedAt')::timestamptz;
    PERFORM public.swim_validate_prescription(v_entry->'previous');
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_definition->'modifications')) THEN
    RAISE EXCEPTION 'Swimming modification IDs must be unique.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_workout_append(p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_old_count integer := jsonb_array_length(p_old->'modifications');
  v_new_count integer := jsonb_array_length(p_new->'modifications');
BEGIN
  IF p_old->'original' IS DISTINCT FROM p_new->'original'
     OR p_old->'resultHistory' IS DISTINCT FROM p_new->'resultHistory'
     OR NOT public.swim_array_append_only(p_old->'modifications', p_new->'modifications')
     OR v_new_count > v_old_count + 1 THEN
    RAISE EXCEPTION 'Swimming original prescriptions and history cannot be replaced.';
  END IF;
  IF (p_old->'issued' IS DISTINCT FROM p_new->'issued' AND v_new_count <> v_old_count + 1)
     OR (v_new_count > v_old_count AND p_new->'modifications'->v_old_count->'previous' IS DISTINCT FROM p_old->'issued') THEN
    RAISE EXCEPTION 'Swimming changes must retain the previously issued prescription.';
  END IF;
END $$;

CREATE FUNCTION public.swim_validate_result(p_result jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_split jsonb; v_lengths bigint; v_ms bigint;
  v_split_lengths bigint := 0; v_split_ms bigint := 0; v_rpe numeric;
BEGIN
  IF p_result->'version' IS DISTINCT FROM '1'::jsonb
     OR p_result->>'completion' IS NULL OR p_result->>'completion' NOT IN ('completed','partial')
     OR p_result->'provenance'->>'source' IS DISTINCT FROM 'manual'
     OR NULLIF(p_result->'provenance'->>'recordedAt', '') IS NULL OR NOT (p_result ? 'rpe') THEN
    RAISE EXCEPTION 'Invalid native swimming result.';
  END IF;
  PERFORM (p_result->'provenance'->>'recordedAt')::timestamptz;
  PERFORM public.swim_validate_snapshot(p_result->'snapshot');
  v_lengths := public.swim_bounded_integer(p_result->'lengths', 1, 2000);
  v_ms := public.swim_bounded_integer(p_result->'timeMs', 1, 86400000);
  IF p_result->'rpe' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_result->'rpe') <> 'number' THEN RAISE EXCEPTION 'Invalid swimming effort.'; END IF;
    v_rpe := (p_result->>'rpe')::numeric;
    IF v_rpe NOT BETWEEN 0 AND 10 OR v_rpe <> round(v_rpe, 1) THEN
      RAISE EXCEPTION 'Swimming effort must be 0 to 10 in tenths.';
    END IF;
  END IF;
  IF p_result ? 'splits' THEN
    IF jsonb_typeof(p_result->'splits') <> 'array' OR jsonb_array_length(p_result->'splits') > 2000 THEN
      RAISE EXCEPTION 'Invalid swimming splits.';
    END IF;
    FOR v_split IN SELECT value FROM jsonb_array_elements(p_result->'splits') LOOP
      v_split_lengths := v_split_lengths + public.swim_bounded_integer(v_split->'lengths', 1, 2000);
      v_split_ms := v_split_ms + public.swim_bounded_integer(v_split->'timeMs', 1, 86400000);
    END LOOP;
    IF v_split_lengths > v_lengths OR v_split_ms > v_ms THEN
      RAISE EXCEPTION 'Swimming splits exceed the native result totals.';
    END IF;
  END IF;
END $$;

CREATE FUNCTION public.swim_result_summary(p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_course jsonb := p_result->'snapshot'->'course';
  v_numerator bigint; v_denominator bigint; v_rounded_metres bigint;
BEGIN
  PERFORM public.swim_validate_result(p_result);
  -- Exact rational arithmetic until the one-way compatibility rounding boundary.
  -- 1 yd = 1143/1250 m. Never read these rounded columns as native swimming.
  v_numerator := public.swim_bounded_integer(p_result->'lengths', 1, 2000)
    * public.swim_bounded_integer(v_course->'numerator', 1, 1000000);
  v_denominator := public.swim_bounded_integer(v_course->'denominator', 1, 10000);
  IF v_course->>'unit' = 'yd' THEN
    v_numerator := v_numerator * 1143;
    v_denominator := v_denominator * 1250;
  END IF;
  -- All products are below 2^53 under the validated native bounds.
  v_rounded_metres := (2 * v_numerator + v_denominator) / (2 * v_denominator);
  RETURN jsonb_build_object(
    'durationSec', GREATEST(1, (public.swim_bounded_integer(p_result->'timeMs', 1, 86400000) + 500) / 1000),
    'distanceKm', v_rounded_metres::numeric / 1000,
    'rpe', p_result->'rpe'
  );
END $$;

CREATE FUNCTION public.swim_validate_result_course(p_definition jsonb, p_result jsonb, p_allow_changed_course boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cal jsonb := p_result->'snapshot'->'calibration';
  v_issued_cal jsonb := p_definition->'issued'->'snapshot'->'calibration';
BEGIN
  IF p_result->'snapshot'->'versions'->'model' IS DISTINCT FROM p_definition->'issued'->'snapshot'->'versions'->'model'
     OR p_result->'snapshot'->'versions'->'generator' IS DISTINCT FROM p_definition->'issued'->'snapshot'->'versions'->'generator' THEN
    RAISE EXCEPTION 'Swimming results must retain their issued versions.';
  END IF;
  -- Issued calibration was bound to a verified full source before start. A
  -- result may omit pace, but cannot inject a different, unbound compact rate.
  IF v_cal <> 'null'::jsonb AND
     (v_cal->'msPer100', v_cal->'unit', v_cal->'protocol', v_cal->'observedOn', v_cal->'heuristic', v_cal->'version')
     IS DISTINCT FROM
     (v_issued_cal->'msPer100', v_issued_cal->'unit', v_issued_cal->'protocol',
      v_issued_cal->'observedOn', v_issued_cal->'heuristic', v_issued_cal->'version') THEN
    RAISE EXCEPTION 'Swimming result pace must match its issued calibration.';
  END IF;
  IF p_result->'snapshot'->'course' IS DISTINCT FROM p_definition->'issued'->'snapshot'->'course' THEN
    IF p_allow_changed_course IS DISTINCT FROM true
       OR NULLIF(btrim(p_result->'provenance'->>'deviationReason'), '') IS NULL THEN
      RAISE EXCEPTION 'Confirm the changed pool and record a reason.';
    END IF;
    IF p_result->'snapshot'->'calibration' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'A changed pool cannot reuse the issued pace calibration.';
    END IF;
  END IF;
END $$;

-- Hard-purging a session removes its actual-result revisions as well as its
-- cardio row. The original/issued targets and prescription decisions survive.
CREATE FUNCTION public.swim_forget_purged_actuals()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.session_id IS NOT NULL AND NEW.session_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.sessions WHERE id = OLD.session_id) THEN
      RAISE EXCEPTION 'A swimming session link can only be removed by session purge.';
    END IF;
    NEW.definition := NEW.definition - 'resultHistory';
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER swim_workouts_purge_actuals
  BEFORE UPDATE ON public.swim_workouts
  FOR EACH ROW EXECUTE FUNCTION public.swim_forget_purged_actuals();

-- Every log mutation obtains the same parent-row lock as completion and purge.
-- Cascading deletion is permitted only after the parent session has disappeared.
CREATE FUNCTION public.swim_guard_cardio()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session_id uuid;
  v_linked boolean;
BEGIN
  -- UPDATE/DELETE already hold the cardio row. Reject a native-row edit before
  -- taking its session lock, avoiding cardio -> session against native editors.
  IF TG_OP <> 'INSERT' AND OLD.swim_result IS NOT NULL AND current_user <> 'swim_writer' THEN
    IF TG_OP = 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.sessions WHERE id = OLD.session_id
    ) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Use the swimming result editor for this session.';
  END IF;
  FOR v_session_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.session_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.session_id END
    ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM 1 FROM public.sessions WHERE id = v_session_id FOR UPDATE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.swim_workouts WHERE session_id = v_session_id
    ) INTO v_linked;
    IF v_linked AND current_user <> 'swim_writer' THEN
      RAISE EXCEPTION 'Use the swimming result editor for this session.';
    END IF;
    IF TG_OP <> 'DELETE' AND v_session_id = NEW.session_id THEN
      IF NEW.swim_result IS NOT NULL AND NOT v_linked THEN
        RAISE EXCEPTION 'A swimming result requires its linked workout.';
      END IF;
      IF v_linked THEN
        IF NEW.swim_result IS NULL OR NEW.modality <> 'swimming'
           OR NEW.block_index <> 0 OR NEW.movement_id IS NOT NULL
           OR NEW.external_source IS NOT NULL OR NEW.strava_activity_id IS NOT NULL THEN
          RAISE EXCEPTION 'A swimming session has one native result.';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.cardio_logs
          WHERE session_id = NEW.session_id AND id <> NEW.id
        ) THEN
          RAISE EXCEPTION 'A swimming session already has its cardio result.';
        END IF;
        PERFORM public.swim_validate_result(NEW.swim_result);
        IF NEW.duration_sec IS DISTINCT FROM
             (public.swim_result_summary(NEW.swim_result)->>'durationSec')::integer
           OR NEW.distance_km IS DISTINCT FROM
             (public.swim_result_summary(NEW.swim_result)->>'distanceKm')::numeric
           OR NEW.rpe IS DISTINCT FROM
             (public.swim_result_summary(NEW.swim_result)->>'rpe')::numeric THEN
          RAISE EXCEPTION 'Swimming summary does not match native actuals.';
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cardio_logs_swim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.swim_guard_cardio();

CREATE FUNCTION public.swim_guard_session()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- UPDATE/DELETE already hold this session's row lock before the trigger runs.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF current_user <> 'swim_writer' AND EXISTS (
    SELECT 1 FROM public.swim_workouts WHERE session_id = OLD.id
  ) AND (
    -- Trash/undo, date edits, notes, title, check-in and derived load coefficients remain usable.
    (to_jsonb(NEW) - ARRAY['deleted_at','notes','title','fatigue','soreness',
      'bucket_coeffs','region_coeffs','performed_at','updated_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['deleted_at','notes','title','fatigue','soreness',
      'bucket_coeffs','region_coeffs','performed_at','updated_at'])
  ) THEN
    RAISE EXCEPTION 'Use the swimming result editor for this session.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_swim_guard
  BEFORE UPDATE OR DELETE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.swim_guard_session();

-- Wait until every session row in a bulk statement has been changed before
-- locking plans. A row trigger would hold a plan while waiting for later sessions.
-- This private trigger deliberately retains the swim tables' owner, rather than
-- swim_writer: auth.uid() is NULL during administrator purge/account deletion.
-- Its scope comes exclusively from trusted transition rows, never caller input.
CREATE FUNCTION public.swim_invalidate_session_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE v_plan_ids uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The FK has already cleared workout.session_id. Conservatively invalidate
    -- the deleted sessions' owners' plans without retaining a second session link.
    SELECT array_agg(plan.id) INTO v_plan_ids FROM public.swim_plans AS plan
      WHERE plan.user_id IN (SELECT user_id FROM swim_old_sessions);
  ELSE
    SELECT array_agg(DISTINCT workout.plan_id) INTO v_plan_ids
      FROM swim_old_sessions AS old_session
      JOIN swim_new_sessions AS new_session ON new_session.id = old_session.id
      JOIN public.swim_workouts AS workout
        ON workout.session_id = old_session.id AND workout.user_id = old_session.user_id
      WHERE new_session.deleted_at IS DISTINCT FROM old_session.deleted_at
         OR new_session.performed_at IS DISTINCT FROM old_session.performed_at;
  END IF;
  PERFORM 1 FROM public.swim_plans WHERE id = ANY(v_plan_ids) ORDER BY id FOR UPDATE;
  UPDATE public.swim_plans AS plan SET revision = plan.revision + 1, updated_at = now()
    WHERE plan.id = ANY(v_plan_ids);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.swim_invalidate_session_source()
  FROM PUBLIC, anon, authenticated, service_role, swim_writer;
CREATE TRIGGER sessions_swim_source_revision
  AFTER UPDATE ON public.sessions
  REFERENCING OLD TABLE AS swim_old_sessions NEW TABLE AS swim_new_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.swim_invalidate_session_source();
CREATE TRIGGER sessions_swim_purge_revision
  AFTER DELETE ON public.sessions
  REFERENCING OLD TABLE AS swim_old_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public.swim_invalidate_session_source();

CREATE FUNCTION public.swim_guard_strength()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_session_id uuid;
BEGIN
  FOR v_session_id IN
    SELECT DISTINCT id FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.session_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.session_id END
    ]) AS ids(id) WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM 1 FROM public.sessions WHERE id = v_session_id FOR UPDATE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM public.swim_workouts WHERE session_id = v_session_id) THEN
      RAISE EXCEPTION 'Strength logs cannot be added to a swimming workout.';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_logs_swim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.set_logs
  FOR EACH ROW EXECUTE FUNCTION public.swim_guard_strength();
CREATE TRIGGER session_movements_swim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.session_movements
  FOR EACH ROW EXECUTE FUNCTION public.swim_guard_strength();

REVOKE ALL ON FUNCTION public.swim_guard_cardio(),
  public.swim_guard_session(), public.swim_guard_strength() FROM PUBLIC;

-- This categorical map mirrors domain swimming.ts, not a new load multiplier.
CREATE FUNCTION public.swim_prescription_regions(p_workout jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item jsonb; v_primary text; v_regions text[];
  v_union text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.swim_validate_prescription(p_workout);
  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_workout->'sections') section
    CROSS JOIN LATERAL jsonb_array_elements(section.value->'items') item
  LOOP
    SELECT primary_region, regions INTO v_primary, v_regions FROM (VALUES
      ('freestyle', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','foot_ankle_calf']),
      ('backstroke', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','foot_ankle_calf']),
      ('butterfly', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','foot_ankle_calf']),
      ('choice', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','foot_ankle_calf']),
      ('breaststroke', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','adductor_groin']),
      ('individual_medley', 'shoulder_scapular', ARRAY['shoulder_scapular','elbow_forearm','lumbar_trunk','knee','adductor_groin','foot_ankle_calf']),
      ('kick', 'knee', ARRAY['knee','lumbar_trunk','hamstring_posterior','foot_ankle_calf'])
    ) mapping(stroke, primary_region, regions) WHERE stroke = v_item->>'stroke';
    IF v_item->'equipment' ? 'fins' THEN
      v_regions := v_regions || ARRAY['foot_ankle_calf'];
    END IF;
    IF v_item->'equipment' ? 'paddles' THEN v_regions := array_append(v_regions, 'elbow_forearm'); END IF;
    IF v_item->'equipment' ? 'kickboard' THEN v_regions := array_append(v_regions, 'shoulder_scapular'); END IF;
    IF v_item->'equipment' ? 'pull_buoy' AND v_item->>'stroke' <> 'kick' THEN
      SELECT array_agg(r) INTO v_regions FROM unnest(v_regions) r
        WHERE r = v_primary OR r NOT IN ('adductor_groin','knee','hamstring_posterior','foot_ankle_calf');
    END IF;
    v_union := v_union || v_regions;
  END LOOP;
  RETURN ARRAY(SELECT DISTINCT r FROM unnest(v_union) r ORDER BY r);
END $$;

-- Serialize insert/update/delete as well as start, including newly added
-- limitation rows. Do not FOR UPDATE the limitation rows after this lock:
-- their normal row mutations have already locked them before invoking triggers.
CREATE FUNCTION public.swim_serialize_limitation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_owner uuid;
BEGIN
  FOR v_owner IN SELECT DISTINCT id FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.user_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.user_id END
  ]) owners(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('swim-safety:' || v_owner::text, 0));
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER limitations_swim_serialization
  BEFORE INSERT OR UPDATE OR DELETE ON public.limitations
  FOR EACH ROW EXECUTE FUNCTION public.swim_serialize_limitation_change();

CREATE FUNCTION public.swim_assert_start_safety(p_workout jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_regions text[]; v_slug text; v_movement_ids uuid[];
  v_allowed_ids uuid[]; v_muscle_filter_bypassed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-safety:' || auth.uid()::text, 0));
  v_regions := public.swim_prescription_regions(p_workout);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_workout->'sections') section
    CROSS JOIN LATERAL jsonb_array_elements(section.value->'items') item
    WHERE item.value->>'effort' NOT IN ('easy','steady')
  ) THEN 'swim-intervals' ELSE 'swim-easy' END INTO v_slug;
  SELECT array_agg(id ORDER BY id) INTO v_movement_ids FROM public.movements
    WHERE slug = v_slug AND (user_id IS NULL OR user_id = auth.uid());
  IF v_movement_ids IS NULL OR cardinality(v_movement_ids) = 0 THEN
    RAISE EXCEPTION 'Could not check swimming movements. Try again before starting.';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT allowed.id), ARRAY[]::uuid[]) INTO v_allowed_ids
    FROM public.limitations limitation
    CROSS JOIN LATERAL unnest(limitation.allowed_movement_ids) allowed(id)
    WHERE limitation.user_id = auth.uid() AND limitation.resolved_at IS NULL;
  v_muscle_filter_bypassed := v_movement_ids <@ v_allowed_ids;
  IF EXISTS (
    SELECT 1 FROM public.limitations limitation
    CROSS JOIN LATERAL unnest(limitation.affected_movement_ids) blocked(id)
    WHERE limitation.user_id = auth.uid() AND limitation.resolved_at IS NULL
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
      WHERE user_id = auth.uid() AND resolved_at IS NULL
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

CREATE FUNCTION public.swim_validate_plan_binding(
  p_plan jsonb, p_workout jsonb, p_state jsonb, p_previous jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cal jsonb := p_workout->'issued'->'snapshot'->'calibration';
  v_previous_cal jsonb := p_previous->'issued'->'snapshot'->'calibration';
  v_source jsonb := p_state->'acceptedCalibration';
BEGIN
  IF p_workout->'issued'->'snapshot'->'course' IS DISTINCT FROM p_plan->'setup'->'course'
     OR p_workout->'issued'->'snapshot'->'versions'->>'generator' IS DISTINCT FROM p_plan->>'generatorVersion' THEN
    RAISE EXCEPTION 'The swimming prescription does not match its plan setup.';
  END IF;
  -- An unchanged issued compact snapshot keeps its previously verified source.
  -- New pace must bind to the full, explicitly accepted calibration.
  IF v_cal <> 'null'::jsonb AND
     (v_cal->'msPer100', v_cal->'unit', v_cal->'protocol', v_cal->'observedOn', v_cal->'heuristic', v_cal->'version')
     IS DISTINCT FROM
     (v_previous_cal->'msPer100', v_previous_cal->'unit', v_previous_cal->'protocol',
      v_previous_cal->'observedOn', v_previous_cal->'heuristic', v_previous_cal->'version') THEN
    IF v_source IS NULL OR v_source = 'null'::jsonb THEN
      RAISE EXCEPTION 'Accept a verified swimming assessment before issuing pace.';
    END IF;
    PERFORM public.swim_validate_verified_calibration(v_source);
    IF v_source->'course' IS DISTINCT FROM p_plan->'setup'->'course'
       OR (v_cal->'msPer100', v_cal->'unit', v_cal->'protocol', v_cal->'observedOn', v_cal->'heuristic', v_cal->'version')
          IS DISTINCT FROM
          (v_source->'msPer100', v_source->'unit', v_source->'protocol',
           v_source->'observation'->'observedOn', v_source->'heuristic', v_source->'version') THEN
      RAISE EXCEPTION 'Swimming pace must match its accepted assessment.';
    END IF;
  END IF;
END $$;

CREATE FUNCTION public.swim_create_plan(
  p_started_on date, p_ends_on date, p_definition jsonb, p_state jsonb, p_workouts jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_user_id uuid := auth.uid();
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

CREATE FUNCTION public.swim_start_workout(p_workout_id uuid, p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE
  v_plan public.swim_plans;
  v_workout public.swim_workouts;
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  IF v_workout.session_id IS NULL AND v_workout.status = 'scheduled' THEN
    -- Serialize first starts before any plan lock, then reread after a concurrent
    -- creator commits. Replays never need to enter the plan-first mutation path.
    PERFORM pg_advisory_xact_lock(hashtextextended('swim-start:' || v_workout.id::text, 0));
    SELECT * INTO v_workout FROM public.swim_workouts
      WHERE id = p_workout_id AND user_id = auth.uid();
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
    WHERE w.id = p_workout_id AND p.user_id = auth.uid() FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid()
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
    VALUES (auth.uid(), 'Pool swim', v_workout.slot) RETURNING id INTO v_session_id;
  UPDATE public.swim_workouts
    SET session_id = v_session_id, status = 'started',
        revision = revision + 1, updated_at = now()
    WHERE id = v_workout.id RETURNING * INTO v_workout;
  UPDATE public.swim_plans SET revision = revision + 1, updated_at = now() WHERE id = v_workout.plan_id;
  RETURN to_jsonb(v_workout);
END $$;

CREATE FUNCTION public.swim_set_plan_status(
  p_plan_id uuid, p_expected_revision integer, p_status text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE v_plan public.swim_plans;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || auth.uid()::text, 0));
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = auth.uid() FOR UPDATE;
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

CREATE FUNCTION public.swim_skip_workout(p_workout_id uuid, p_expected_revision integer, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public SET row_security = on
AS $$
DECLARE v_workout public.swim_workouts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM 1 FROM public.swim_plans p JOIN public.swim_workouts w ON w.plan_id = p.id
    WHERE w.id = p_workout_id AND p.user_id = auth.uid() FOR UPDATE OF p;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid()
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

CREATE FUNCTION public.swim_update_plan(
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = auth.uid() FOR UPDATE;
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
      WHERE id = (v_update->>'id')::uuid AND plan_id = p_plan_id AND user_id = auth.uid()
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

CREATE FUNCTION public.swim_resume_plan(
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-plan:' || auth.uid()::text, 0));
  SELECT * INTO v_plan FROM public.swim_plans
    WHERE id = p_plan_id AND user_id = auth.uid() FOR UPDATE;
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
      WHERE id = (v_update->>'id')::uuid AND plan_id = p_plan_id AND user_id = auth.uid()
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

CREATE FUNCTION public.swim_complete_workout(
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid();
  IF NOT FOUND OR v_workout.session_id IS NULL THEN
    RAISE EXCEPTION 'Start the swimming workout before completing it.';
  END IF;
  -- This lock also serializes generic logging, completion, editing and purge.
  SELECT * INTO v_session FROM public.sessions
    WHERE id = v_workout.session_id AND user_id = auth.uid() AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming session not found.'; END IF;
  PERFORM 1 FROM public.swim_plans
    WHERE id = v_workout.plan_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid() AND session_id = v_session.id FOR UPDATE;
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

CREATE FUNCTION public.swim_edit_result(
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts WHERE id = p_workout_id AND user_id = auth.uid();
  IF NOT FOUND OR v_workout.session_id IS NULL THEN RAISE EXCEPTION 'Swimming workout not found.'; END IF;
  SELECT * INTO v_session FROM public.sessions
    WHERE id = v_workout.session_id AND user_id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming session not found.'; END IF;
  IF v_session.completed_at IS NULL THEN RAISE EXCEPTION 'Complete this swim before editing its result.'; END IF;
  PERFORM 1 FROM public.swim_plans
    WHERE id = v_workout.plan_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.'; END IF;
  SELECT * INTO v_workout FROM public.swim_workouts
    WHERE id = p_workout_id AND user_id = auth.uid() AND session_id = v_session.id FOR UPDATE;
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

-- The RPC owner cannot log in or bypass RLS. Authenticated callers cannot SET ROLE
-- to it, change snapshots directly, or manufacture an RPC-origin marker.
GRANT CREATE ON SCHEMA public TO swim_writer;
DO $$
DECLARE v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature, p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(ARRAY[
      'swim_storage_ready', 'swim_local_today', 'swim_bounded_integer', 'swim_array_append_only',
      'swim_validate_course', 'swim_validate_labels', 'swim_validate_snapshot',
      'swim_validate_prescription', 'swim_validate_observation', 'swim_validate_verified_calibration',
      'swim_validate_plan', 'swim_validate_workout',
      'swim_validate_state_append', 'swim_validate_workout_append', 'swim_validate_plan_binding',
      'swim_validate_result', 'swim_result_summary', 'swim_validate_result_course',
      'swim_guard_cardio', 'swim_guard_session', 'swim_guard_strength', 'swim_forget_purged_actuals',
      'swim_prescription_regions', 'swim_serialize_limitation_change', 'swim_assert_start_safety',
      'swim_create_plan', 'swim_start_workout', 'swim_update_plan', 'swim_resume_plan',
      'swim_set_plan_status', 'swim_skip_workout', 'swim_complete_workout', 'swim_edit_result'
    ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO swim_writer', v_function.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function.signature);
    IF v_function.proname = ANY(ARRAY[
      'swim_storage_ready', 'swim_create_plan', 'swim_start_workout', 'swim_update_plan', 'swim_resume_plan',
      'swim_set_plan_status', 'swim_skip_workout', 'swim_complete_workout', 'swim_edit_result'
    ]) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_function.signature);
    END IF;
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM swim_writer;
