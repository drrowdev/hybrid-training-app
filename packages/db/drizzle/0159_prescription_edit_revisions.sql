-- Revisions live with the prescription; existing writers remain compatible.
CREATE FUNCTION public.stamp_prescription_revision()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.prescription IS NOT NULL AND NEW.prescription IS DISTINCT FROM OLD.prescription THEN
    IF jsonb_typeof(NEW.prescription->'meta') NOT IN ('object','null') THEN
      RAISE EXCEPTION 'Invalid prescription metadata.' USING ERRCODE='22023';
    END IF;
    NEW.prescription := jsonb_set(NEW.prescription, '{meta}',
      COALESCE(NULLIF(NEW.prescription->'meta','null'::jsonb),'{}'::jsonb) ||
      jsonb_build_object('editRevision',gen_random_uuid()::text));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stamp_prescription_revision() FROM PUBLIC,anon;
CREATE TRIGGER prescription_revision BEFORE UPDATE OF prescription ON public.planned_sessions
FOR EACH ROW EXECUTE FUNCTION public.stamp_prescription_revision();
CREATE TRIGGER prescription_revision BEFORE UPDATE OF prescription ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.stamp_prescription_revision();

CREATE FUNCTION public.save_prescription_if_current(
  p_target text,p_id uuid,p_expected_revision text,p_prescription jsonb,p_require_unstarted boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); current_prescription jsonb; result jsonb; linked uuid;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  IF p_target='planned_sessions' THEN
    SELECT prescription,completed_session_id INTO current_prescription,linked
      FROM public.planned_sessions WHERE id=p_id AND user_id=u FOR UPDATE;
  ELSIF p_target='sessions' THEN
    SELECT prescription INTO current_prescription FROM public.sessions
      WHERE id=p_id AND user_id=u AND deleted_at IS NULL AND completed_at IS NULL FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Invalid prescription target.' USING ERRCODE='22023';
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workout is no longer available to edit.' USING ERRCODE='42501'; END IF;
  IF p_expected_revision IS DISTINCT FROM COALESCE(current_prescription#>>'{meta,editRevision}','0') THEN
    RETURN jsonb_build_object('conflict',true,'prescription',current_prescription);
  END IF;
  IF p_require_unstarted AND linked IS NOT NULL THEN
    RAISE EXCEPTION 'This workout has started. Reload it before editing.' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(p_prescription->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid workout prescription.' USING ERRCODE='22023';
  END IF;
  IF p_target='planned_sessions' THEN
    UPDATE public.planned_sessions SET prescription=p_prescription
      WHERE id=p_id AND user_id=u RETURNING prescription INTO result;
  ELSE
    UPDATE public.sessions SET prescription=p_prescription
      WHERE id=p_id AND user_id=u RETURNING prescription INTO result;
  END IF;
  RETURN jsonb_build_object('conflict',false,'prescription',result);
END $$;
REVOKE ALL ON FUNCTION public.save_prescription_if_current(text,uuid,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_prescription_if_current(text,uuid,text,jsonb,boolean) TO authenticated;
