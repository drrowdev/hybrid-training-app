-- Existing rows, owner checks, grants and mutation RPCs are unchanged.
CREATE FUNCTION public.swim_validate_pool_reissue(p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_section jsonb; v_new_section jsonb; v_old_item jsonb; v_new_item jsonb;
  v_from jsonb := p_old->'snapshot'->'course'; v_to jsonb := p_new->'snapshot'->'course';
  v_section integer; v_item integer;
BEGIN
  IF (p_old - 'sections' - 'totalLengths' - 'snapshot' - 'estimatedMs' - 'budget')
       IS DISTINCT FROM (p_new - 'sections' - 'totalLengths' - 'snapshot' - 'estimatedMs' - 'budget')
     OR ((p_old->'snapshot') - 'course' - 'calibration' - 'protocol' - 'versions')
       IS DISTINCT FROM ((p_new->'snapshot') - 'course' - 'calibration' - 'protocol' - 'versions')
     OR ((p_old->'snapshot'->'versions') - 'assessment')
       IS DISTINCT FROM ((p_new->'snapshot'->'versions') - 'assessment')
     OR ((p_old->'budget') - 'accountedMs') IS DISTINCT FROM ((p_new->'budget') - 'accountedMs')
     OR jsonb_array_length(p_old->'sections') IS DISTINCT FROM jsonb_array_length(p_new->'sections') THEN
    RAISE EXCEPTION 'A pool change must preserve the prescribed workout.';
  END IF;
  FOR v_section IN 0..jsonb_array_length(p_old->'sections') - 1 LOOP
    v_old_section := p_old->'sections'->v_section; v_new_section := p_new->'sections'->v_section;
    IF (v_old_section - 'items') IS DISTINCT FROM (v_new_section - 'items')
       OR jsonb_array_length(v_old_section->'items') IS DISTINCT FROM jsonb_array_length(v_new_section->'items') THEN
      RAISE EXCEPTION 'A pool change must preserve the prescribed sections.';
    END IF;
    FOR v_item IN 0..jsonb_array_length(v_old_section->'items') - 1 LOOP
      v_old_item := v_old_section->'items'->v_item; v_new_item := v_new_section->'items'->v_item;
      IF (v_old_item - 'lengths' - 'targetMsPerRepeat') IS DISTINCT FROM (v_new_item - 'lengths' - 'targetMsPerRepeat')
         OR (v_old_item->>'lengths')::numeric * (v_from->>'numerator')::numeric * (v_to->>'denominator')::numeric
            * (CASE WHEN v_from->>'unit' = 'yd' THEN 9144 ELSE 10000 END)
           <> (v_new_item->>'lengths')::numeric * (v_to->>'numerator')::numeric * (v_from->>'denominator')::numeric
            * (CASE WHEN v_to->>'unit' = 'yd' THEN 9144 ELSE 10000 END) THEN
        RAISE EXCEPTION 'A pool change must preserve every repeat distance.';
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.swim_validate_pool_reissue(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_validate_pool_reissue(jsonb, jsonb) TO swim_writer;

CREATE OR REPLACE FUNCTION public.swim_validate_state_append(p_old jsonb, p_new jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_decision jsonb := p_new->'decisions'->(-1);
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
  IF p_new ? 'poolCourse' THEN PERFORM public.swim_validate_course(p_new->'poolCourse'); END IF;
  IF p_old->'poolCourse' IS DISTINCT FROM p_new->'poolCourse' THEN
    IF v_decision->>'kind' IS DISTINCT FROM 'setup' OR v_decision->>'decision' IS DISTINCT FROM 'accepted'
       OR v_decision->'inputSnapshot'->>'operation' IS DISTINCT FROM 'pool'
       OR v_decision->'inputSnapshot'->>'scope' IS DISTINCT FROM 'plan'
       OR v_decision->'inputSnapshot'->'course' IS DISTINCT FROM p_new->'poolCourse' THEN
      RAISE EXCEPTION 'Accept the programme pool change before saving it.';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swim_validate_plan_binding(
  p_plan jsonb, p_workout jsonb, p_state jsonb, p_previous jsonb DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cal jsonb := p_workout->'issued'->'snapshot'->'calibration';
  v_previous_cal jsonb := p_previous->'issued'->'snapshot'->'calibration';
  v_source jsonb := p_state->'acceptedCalibration';
  v_decision jsonb := p_state->'decisions'->(-1);
  v_course jsonb;
  v_pool_change boolean := v_decision->'inputSnapshot'->>'operation' = 'pool';
BEGIN
  IF p_previous IS NULL THEN
    IF p_workout ? 'poolCourse' OR p_state ? 'poolCourse' THEN
      RAISE EXCEPTION 'Create the programme with its initial pool first.';
    END IF;
    v_course := p_plan->'setup'->'course';
  ELSIF v_pool_change AND (
    v_decision->'inputSnapshot'->>'scope' = 'plan'
    OR v_decision->'inputSnapshot'->>'slotId' = p_workout->>'slotId'
  ) THEN
    v_course := COALESCE(p_workout->'poolCourse', p_state->'poolCourse', p_plan->'setup'->'course');
  ELSE
    v_course := COALESCE(p_workout->'poolCourse', p_previous->'issued'->'snapshot'->'course');
  END IF;
  PERFORM public.swim_validate_course(v_course);
  IF p_workout->'poolCourse' IS DISTINCT FROM p_previous->'poolCourse' THEN
    IF v_decision->>'kind' IS DISTINCT FROM 'setup' OR v_decision->>'decision' IS DISTINCT FROM 'accepted'
       OR v_decision->'inputSnapshot'->>'operation' IS DISTINCT FROM 'pool'
       OR v_decision->'inputSnapshot'->>'scope' IS DISTINCT FROM 'workout'
       OR v_decision->'inputSnapshot'->>'slotId' IS DISTINCT FROM p_workout->>'slotId'
       OR COALESCE(v_decision->'inputSnapshot'->'course', 'null'::jsonb)
         IS DISTINCT FROM COALESCE(p_workout->'poolCourse', 'null'::jsonb) THEN
      RAISE EXCEPTION 'Accept this workout pool change before saving it.';
    END IF;
  END IF;
  IF p_workout->'issued'->'snapshot'->'course' IS DISTINCT FROM v_course
     OR p_workout->'issued'->'snapshot'->'versions'->>'generator' IS DISTINCT FROM p_plan->>'generatorVersion' THEN
    RAISE EXCEPTION 'The swimming prescription does not match its selected pool.';
  END IF;
  IF v_pool_change AND p_previous IS NOT NULL THEN
    PERFORM public.swim_validate_pool_reissue(p_previous->'issued', p_workout->'issued');
  END IF;
  -- An unchanged compact snapshot is reusable only in its previously verified course.
  IF v_cal <> 'null'::jsonb AND (
     p_workout->'issued'->'snapshot'->'course' IS DISTINCT FROM p_previous->'issued'->'snapshot'->'course'
     OR (v_cal->'msPer100', v_cal->'unit', v_cal->'protocol', v_cal->'observedOn', v_cal->'heuristic', v_cal->'version')
       IS DISTINCT FROM
       (v_previous_cal->'msPer100', v_previous_cal->'unit', v_previous_cal->'protocol',
        v_previous_cal->'observedOn', v_previous_cal->'heuristic', v_previous_cal->'version')
  ) THEN
    IF v_source IS NULL OR v_source = 'null'::jsonb THEN
      RAISE EXCEPTION 'Accept a verified swimming assessment before issuing pace.';
    END IF;
    PERFORM public.swim_validate_verified_calibration(v_source);
    IF v_source->'course' IS DISTINCT FROM v_course
       OR (v_cal->'msPer100', v_cal->'unit', v_cal->'protocol', v_cal->'observedOn', v_cal->'heuristic', v_cal->'version')
         IS DISTINCT FROM
         (v_source->'msPer100', v_source->'unit', v_source->'protocol',
          v_source->'observation'->'observedOn', v_source->'heuristic', v_source->'version') THEN
      RAISE EXCEPTION 'Swimming pace must match an assessment in this pool.';
    END IF;
  END IF;
END $$;

CREATE FUNCTION public.swim_pool_editing_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.swim_pool_editing_ready() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_pool_editing_ready() TO authenticated;
