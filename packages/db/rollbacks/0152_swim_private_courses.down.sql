BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.swim_plans, public.swim_workouts IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_plans
      WHERE definition ? 'privateCourse' OR definition->>'generatorVersion' = 'swim-course-1')
     OR EXISTS (SELECT 1 FROM public.swim_workouts WHERE definition ? 'courseSource'
      OR definition->'original'->'snapshot'->'versions'->>'generator' = 'swim-course-1') THEN
    RAISE EXCEPTION 'Cannot remove private course support while imported swimming plans remain.';
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
DROP FUNCTION public.swim_private_course_ready();
DROP FUNCTION public.swim_validate_private_course_binding(jsonb, jsonb, jsonb, jsonb);
COMMIT;
