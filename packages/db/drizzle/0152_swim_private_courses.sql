-- Private source metadata stays in existing owner-scoped JSONB. No row migration.
CREATE FUNCTION public.swim_validate_private_course_binding(p_plan jsonb, p_workout jsonb, p_state jsonb, p_previous jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source jsonb := p_workout->'courseSource';
  v_original jsonb := p_workout->'original';
  v_course jsonb := v_original->'snapshot'->'course';
  v_decision jsonb := p_state->'decisions'->(-1);
  v_section jsonb; v_item jsonb; v_issued_section jsonb; v_issued_item jsonb;
  v_s integer; v_i integer; v_total numeric;
BEGIN
  IF p_plan->'privateCourse'->>'version' IS DISTINCT FROM 'swim-course-1'
     OR p_plan ? 'initialDose'
     OR jsonb_typeof(p_plan->'privateCourse'->'title') IS DISTINCT FROM 'string'
     OR length(btrim(p_plan->'privateCourse'->>'title')) NOT BETWEEN 1 AND 100
     OR jsonb_typeof(p_plan->'privateCourse'->'source'->'reference') IS DISTINCT FROM 'string'
     OR length(btrim(p_plan->'privateCourse'->'source'->>'reference')) NOT BETWEEN 1 AND 500
     OR jsonb_typeof(p_plan->'privateCourse'->'source'->'edition') IS DISTINCT FROM 'string'
     OR length(btrim(p_plan->'privateCourse'->'source'->>'edition')) NOT BETWEEN 1 AND 100
     OR jsonb_typeof(v_source->'title') IS DISTINCT FROM 'string'
     OR length(btrim(v_source->>'title')) NOT BETWEEN 1 AND 100
     OR v_original->'snapshot'->'versions'->>'generator' IS DISTINCT FROM 'swim-course-1'
     OR v_course->>'unit' IS DISTINCT FROM 'm'
     OR p_workout->'issued'->'snapshot'->'course'->>'unit' IS DISTINCT FROM 'm' THEN
    RAISE EXCEPTION 'Invalid imported swimming course.';
  END IF;
  IF p_state->'acceptedCalibration' IS DISTINCT FROM 'null'::jsonb
     OR p_state->'observations' IS DISTINCT FROM '[]'::jsonb
     OR v_original->'snapshot'->'calibration' IS DISTINCT FROM 'null'::jsonb
     OR p_workout->'issued'->'snapshot'->'calibration' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Imported courses require explicit workout edits, not automatic assessment changes.';
  END IF;
  PERFORM public.swim_bounded_integer(p_plan->'schedule'->'weeks', 2, 16);
  PERFORM public.swim_bounded_integer(p_workout->'weekIndex', 0, (p_plan->'schedule'->>'weeks')::integer - 1);
  IF jsonb_typeof(p_plan->'schedule'->'weekdays') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_plan->'schedule'->'weekdays') NOT BETWEEN 1 AND 7
     OR NULLIF(p_plan->'schedule'->>'startDate', '') IS NULL
     OR p_workout->>'slotId' IS NULL OR p_workout->>'slotId' !~ '^course-[0-9]+-[0-6]$'
     OR split_part(p_workout->>'slotId', '-', 2)::integer <> (p_workout->>'weekIndex')::integer
     OR p_workout->'provisional' IS DISTINCT FROM 'false'::jsonb
     OR NOT ((p_plan->'setup'->'equipment') @> (p_workout->'issued'->'snapshot'->'equipment')) THEN
    RAISE EXCEPTION 'Invalid imported swimming schedule or equipment.';
  END IF;
  PERFORM (p_plan->'schedule'->>'startDate')::date;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_plan->'schedule'->'weekdays') LOOP
    PERFORM public.swim_bounded_integer(v_item, 0, 6);
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements(p_plan->'schedule'->'weekdays')) THEN
    RAISE EXCEPTION 'Choose each swimming day once.';
  END IF;
  IF jsonb_typeof(v_source->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_source->'sections') IS DISTINCT FROM jsonb_array_length(v_original->'sections') THEN
    RAISE EXCEPTION 'Retain every imported swimming section.';
  END IF;
  FOR v_s IN 0..jsonb_array_length(v_original->'sections') - 1 LOOP
    v_section := v_source->'sections'->v_s; v_issued_section := v_original->'sections'->v_s;
    IF (v_section - 'items') IS DISTINCT FROM (v_issued_section - 'items')
       OR jsonb_typeof(v_section->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_section->'items') IS DISTINCT FROM jsonb_array_length(v_issued_section->'items') THEN
      RAISE EXCEPTION 'Retain every imported swimming section.';
    END IF;
    FOR v_i IN 0..jsonb_array_length(v_issued_section->'items') - 1 LOOP
      v_item := v_section->'items'->v_i; v_issued_item := v_issued_section->'items'->v_i;
      PERFORM public.swim_bounded_integer(v_item->'distanceMetres', 1, 100000);
      IF (v_item - 'distanceMetres' - 'sendoffSeconds')
           IS DISTINCT FROM (v_issued_item - 'lengths' - 'optional' - 'sendoffMs')
         OR v_issued_item->'optional' IS DISTINCT FROM 'false'::jsonb
         OR (v_item->>'distanceMetres')::numeric * (v_course->>'denominator')::numeric
           <> (v_issued_item->>'lengths')::numeric * (v_course->>'numerator')::numeric
         OR (v_item ? 'sendoffSeconds') IS DISTINCT FROM (v_issued_item ? 'sendoffMs')
         OR (v_item ? 'restSeconds' AND v_item ? 'sendoffSeconds')
         OR (v_item ? 'sendoffSeconds' AND
           (v_item->>'sendoffSeconds')::numeric * 1000 IS DISTINCT FROM (v_issued_item->>'sendoffMs')::numeric) THEN
        RAISE EXCEPTION 'Retain the exact imported swimming repetitions.';
      END IF;
    END LOOP;
  END LOOP;
  IF v_source ? 'sourcePage' THEN PERFORM public.swim_bounded_integer(v_source->'sourcePage', 1, 10000); END IF;
  IF v_source ? 'reportedDistanceMetres' THEN
    PERFORM public.swim_bounded_integer(v_source->'reportedDistanceMetres', 1, 100000);
    v_total := (v_original->>'totalLengths')::numeric * (v_course->>'numerator')::numeric / (v_course->>'denominator')::numeric;
    IF p_previous IS NULL AND (v_source->>'reportedDistanceMetres')::numeric <> v_total
       AND v_decision->'inputSnapshot'->'acceptSetTotals' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'Confirm the listed set distances before importing conflicting totals.';
    END IF;
  END IF;
  IF p_previous IS NULL THEN
    IF v_decision->>'kind' IS DISTINCT FROM 'setup' OR v_decision->>'decision' IS DISTINCT FROM 'accepted'
       OR v_decision->>'ruleVersion' IS DISTINCT FROM 'swim-course-1'
       OR v_decision->'inputSnapshot'->>'operation' IS DISTINCT FROM 'course-import'
       OR jsonb_typeof(v_decision->'inputSnapshot'->'workouts') IS DISTINCT FROM 'array'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_decision->'inputSnapshot'->'workouts') AS entry(value)
         WHERE value->>'slotId' = p_workout->>'slotId' AND value->'course' = v_course
       ) THEN RAISE EXCEPTION 'Review the imported workouts and pools before saving.'; END IF;
  ELSE
    IF v_source IS DISTINCT FROM p_previous->'courseSource' THEN
      RAISE EXCEPTION 'The imported source cannot be replaced.';
    END IF;
    IF p_workout->'issued' IS DISTINCT FROM p_previous->'issued'
       AND v_decision->'inputSnapshot'->>'operation' IS DISTINCT FROM 'pool' THEN
      IF v_decision->>'kind' IS DISTINCT FROM 'progression' OR v_decision->>'decision' IS DISTINCT FROM 'overridden'
         OR v_decision->>'ruleVersion' IS DISTINCT FROM 'swim-course-1'
         OR v_decision->'inputSnapshot'->>'operation' IS DISTINCT FROM 'course-edit'
         OR v_decision->'inputSnapshot'->>'slotId' IS DISTINCT FROM p_workout->>'slotId'
         OR v_decision->'inputSnapshot'->'issued' IS DISTINCT FROM p_workout->'issued' THEN
        RAISE EXCEPTION 'Review an explicit edit before changing an imported workout.';
      END IF;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.swim_validate_private_course_binding(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_validate_private_course_binding(jsonb, jsonb, jsonb, jsonb) TO swim_writer;

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
  v_private boolean := p_plan->>'generatorVersion' = 'swim-course-1';
BEGIN
  IF v_private THEN
    PERFORM public.swim_validate_private_course_binding(p_plan, p_workout, p_state, p_previous);
  ELSIF p_plan ? 'privateCourse' OR p_workout ? 'courseSource' THEN
    RAISE EXCEPTION 'Imported source metadata requires an imported course.';
  END IF;
  IF p_previous IS NULL THEN
    IF (p_workout ? 'poolCourse' AND NOT v_private) OR p_state ? 'poolCourse' THEN
      RAISE EXCEPTION 'Create the programme with its initial pool first.';
    END IF;
    v_course := COALESCE(p_workout->'poolCourse', p_plan->'setup'->'course');
  ELSIF v_pool_change AND (
    v_decision->'inputSnapshot'->>'scope' = 'plan'
    OR v_decision->'inputSnapshot'->>'slotId' = p_workout->>'slotId'
  ) THEN
    v_course := COALESCE(p_workout->'poolCourse', p_state->'poolCourse', p_plan->'setup'->'course');
  ELSE
    v_course := COALESCE(p_workout->'poolCourse', p_previous->'issued'->'snapshot'->'course');
  END IF;
  PERFORM public.swim_validate_course(v_course);
  IF p_workout->'poolCourse' IS DISTINCT FROM p_previous->'poolCourse'
     AND NOT (p_previous IS NULL AND v_private) THEN
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

CREATE FUNCTION public.swim_private_course_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.swim_private_course_ready() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_private_course_ready() TO authenticated;
