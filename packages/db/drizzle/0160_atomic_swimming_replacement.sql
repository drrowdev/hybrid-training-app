CREATE FUNCTION public.replace_swim_plan_atomically(
  p_plan_id uuid,p_plan_revision integer,p_args jsonb,p_expected_revision text,
  p_request_id uuid,p_input_hash text,p_accept_overlap boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); plan public.swim_plans%ROWTYPE; receipt jsonb; result jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'A valid save request is required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  SELECT context INTO receipt FROM public.engine_override_events WHERE id=p_request_id AND user_id=u;
  IF FOUND THEN
    IF receipt->>'kind' IS DISTINCT FROM 'training-schedule-v1'
      OR receipt->>'operation' IS DISTINCT FROM 'swim-replace'
      OR receipt->>'inputHash' IS DISTINCT FROM p_input_hash
      OR receipt->>'replacedPlanId' IS DISTINCT FROM p_plan_id::text
      OR receipt->>'replacementArgsHash' IS DISTINCT FROM md5(p_args::text) THEN
      RAISE EXCEPTION 'This save request was already used for a different change.' USING ERRCODE='22023';
    END IF;
    RETURN receipt->'result';
  END IF;
  IF p_expected_revision IS DISTINCT FROM public.training_schedule_snapshot()->>'revision' THEN
    RAISE EXCEPTION 'Your schedule changed. Review the dates again.' USING ERRCODE='40001';
  END IF;
  -- Swim writers already hold the shared schedule lock; callers retain read-only table grants.
  SELECT * INTO plan FROM public.swim_plans WHERE id=p_plan_id AND user_id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Swimming plan not found.' USING ERRCODE='42501'; END IF;
  IF plan.status NOT IN ('active','paused') OR plan.revision IS DISTINCT FROM p_plan_revision THEN
    RAISE EXCEPTION 'Swimming plan changed. Review the replacement again.' USING ERRCODE='40001';
  END IF;
  PERFORM public.swim_set_plan_status(p_plan_id,p_plan_revision,'finished');
  result:=public.independent_program_schedule_commit('swim-create',p_args,
    public.training_schedule_snapshot()->>'revision',p_request_id,p_input_hash,p_accept_overlap);
  UPDATE public.engine_override_events SET context=context||jsonb_build_object(
    'operation','swim-replace','replacedPlanId',p_plan_id,'replacementArgsHash',md5(p_args::text),
    'revision',p_expected_revision)
    WHERE id=p_request_id AND user_id=u;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.replace_swim_plan_atomically(uuid,integer,jsonb,text,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_swim_plan_atomically(uuid,integer,jsonb,text,uuid,text,boolean) TO authenticated;
