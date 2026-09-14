BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.swim_plans, public.swim_workouts IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_plans WHERE state ? 'poolCourse'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(state->'decisions') d
         WHERE d->'inputSnapshot'->>'operation' = 'pool'))
     OR EXISTS (SELECT 1 FROM public.swim_workouts WHERE definition ? 'poolCourse') THEN
    RAISE EXCEPTION 'Pool changes exist. Keep their history and roll forward instead.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swim_validate_state_append(p_old jsonb, p_new jsonb)
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
DROP FUNCTION public.swim_pool_editing_ready();
DROP FUNCTION public.swim_validate_pool_reissue(jsonb, jsonb);
COMMIT;
