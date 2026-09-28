ALTER TABLE public.training_maxes DROP CONSTRAINT training_maxes_source_chk;
ALTER TABLE public.training_maxes ADD CONSTRAINT training_maxes_source_chk
  CHECK (source IN ('entered','derived_amrap','derived_rpe','scheduled_progression'));
ALTER TABLE public.tm_suggestions DROP CONSTRAINT tm_suggestions_source_chk;
ALTER TABLE public.tm_suggestions ADD CONSTRAINT tm_suggestions_source_chk
  CHECK (source IN ('derived_amrap','derived_rpe','scheduled_progression'));

CREATE UNIQUE INDEX tm_suggestions_scheduled_pending_idx ON public.tm_suggestions(user_id,movement_id)
  WHERE source='scheduled_progression' AND status='pending';

-- This is a storage guard, not a second movement classifier. The domain owns
-- classification; storage rechecks that the account measurement is still used.
CREATE FUNCTION public.account_max_is_programmed(p_movement_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.training_blocks b JOIN public.planned_sessions p ON p.block_id=b.id
      CROSS JOIN LATERAL jsonb_array_elements(p.prescription->'items') item
    WHERE b.user_id=auth.uid() AND p.user_id=auth.uid() AND b.status='active' AND b.deleted_at IS NULL
      AND item->>'movementId'=p_movement_id::text
      AND jsonb_typeof(item->'percentTm')='number' AND (item->>'percentTm')::numeric>0
      AND (item#>>'{meta,programLoadBasis,kind}'='one-rm'
        OR (b.program_kind IS NULL AND item#>'{meta,programLoadBasis}' IS NULL))
  );
$$;
REVOKE ALL ON FUNCTION public.account_max_is_programmed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.account_max_is_programmed(uuid) TO authenticated;

CREATE FUNCTION public.generate_scheduled_max_progression(p_candidates jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); candidate jsonb; current_max public.training_maxes; inserted integer:=0; count_row integer;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_candidates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_candidates)>500 THEN
    RAISE EXCEPTION 'Invalid max proposals.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  PERFORM 1 FROM public.profiles WHERE id=u AND units='metric'
    AND COALESCE(intake->'suggestScheduled1RmIncreases','true'::jsonb)='true'::jsonb FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  DELETE FROM public.tm_suggestions s WHERE s.user_id=u AND s.source='scheduled_progression' AND s.status='pending'
    AND (NOT EXISTS (SELECT 1 FROM public.training_maxes t WHERE t.user_id=u AND t.movement_id=s.movement_id
      AND t.one_rm_kg=s.current_tm_kg AND t.updated_at<=s.created_at)
      OR EXISTS(SELECT 1 FROM public.tm_suggestions resolved WHERE resolved.user_id=u AND resolved.movement_id=s.movement_id
        AND resolved.status IN ('accepted','dismissed') AND resolved.resolved_at>s.created_at));
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_candidates) ORDER BY value->>'movementId' LOOP
    SELECT * INTO current_max FROM public.training_maxes WHERE user_id=u
      AND movement_id=(candidate->>'movementId')::uuid FOR UPDATE;
    IF NOT FOUND OR current_max.one_rm_kg IS NULL
      OR current_max.updated_at IS DISTINCT FROM (candidate->>'updatedAt')::timestamptz
      OR current_max.one_rm_kg IS DISTINCT FROM (candidate->>'currentOneRmKg')::numeric
      OR current_max.updated_at>now()-interval '21 days'
      OR NOT public.account_max_is_programmed(current_max.movement_id) THEN CONTINUE; END IF;
    IF (candidate->>'proposedOneRmKg')::numeric-current_max.one_rm_kg NOT IN (1.5,2.5)
      OR (candidate->>'proposedOneRmKg')::numeric>1000 THEN
      RAISE EXCEPTION 'Invalid max increase.' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tm_suggestions WHERE user_id=u AND movement_id=current_max.movement_id
      AND status IN ('accepted','dismissed') AND resolved_at>now()-interval '21 days') THEN CONTINUE; END IF;
    INSERT INTO public.tm_suggestions(user_id,movement_id,current_tm_kg,suggested_tm_kg,source)
      VALUES(u,current_max.movement_id,current_max.one_rm_kg,(candidate->>'proposedOneRmKg')::numeric,'scheduled_progression')
      ON CONFLICT(user_id,movement_id) WHERE source='scheduled_progression' AND status='pending' DO NOTHING;
    GET DIAGNOSTICS count_row=ROW_COUNT;
    inserted:=inserted+count_row;
  END LOOP;
  RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public.generate_scheduled_max_progression(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_scheduled_max_progression(jsonb) TO authenticated;

CREATE FUNCTION public.decide_max_suggestions(p_ids uuid[],p_accept boolean)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); suggestion public.tm_suggestions; current_max public.training_maxes;
  default_percent numeric; effective_percent numeric; proposed numeric; processed integer:=0;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_accept IS NULL OR cardinality(p_ids) IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 500
    OR EXISTS(SELECT 1 FROM unnest(p_ids) id GROUP BY id HAVING count(*)>1)
    OR array_position(p_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid suggestions.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  SELECT tm_percent_default INTO default_percent FROM public.profiles WHERE id=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your settings are unavailable.' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.tm_suggestions WHERE user_id=u AND id=ANY(p_ids))<>cardinality(p_ids) THEN
    RAISE EXCEPTION 'Suggestion not found.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT movement_id FROM public.tm_suggestions WHERE user_id=u AND id=ANY(p_ids) GROUP BY movement_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Choose one suggestion per lift.' USING ERRCODE='22023';
  END IF;
  FOR suggestion IN SELECT * FROM public.tm_suggestions WHERE user_id=u AND id=ANY(p_ids) ORDER BY movement_id FOR UPDATE LOOP
    IF suggestion.status<>'pending' THEN
      IF suggestion.status=(CASE WHEN p_accept THEN 'accepted' ELSE 'dismissed' END) THEN CONTINUE; END IF;
      RAISE EXCEPTION 'This suggestion has already been resolved. Reload Today.' USING ERRCODE='40001';
    END IF;
    SELECT * INTO current_max FROM public.training_maxes WHERE user_id=u AND movement_id=suggestion.movement_id FOR UPDATE;
    IF NOT FOUND OR current_max.one_rm_kg IS NULL OR current_max.updated_at>suggestion.created_at THEN
      RAISE EXCEPTION 'This max has changed. Reload Today.' USING ERRCODE='40001';
    END IF;
    IF suggestion.source='scheduled_progression' THEN
      IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND units='metric'
          AND COALESCE(intake->'suggestScheduled1RmIncreases','true'::jsonb)='true'::jsonb)
        OR NOT public.account_max_is_programmed(suggestion.movement_id)
        OR current_max.one_rm_kg IS DISTINCT FROM suggestion.current_tm_kg
        OR EXISTS(SELECT 1 FROM public.tm_suggestions resolved WHERE resolved.user_id=u
          AND resolved.movement_id=suggestion.movement_id AND resolved.status IN ('accepted','dismissed')
          AND resolved.resolved_at>suggestion.created_at) THEN
        RAISE EXCEPTION 'This increase is no longer available. Reload Today.' USING ERRCODE='40001';
      END IF;
      IF EXISTS(SELECT 1 FROM public.tm_suggestions s
        JOIN public.sessions workout ON workout.id=s.derived_from_session_id AND workout.user_id=u
        WHERE s.user_id=u AND s.movement_id=suggestion.movement_id AND s.status='pending'
          AND s.source<>'scheduled_progression' AND s.created_at>=current_max.updated_at
          AND NOT EXISTS(SELECT 1 FROM public.planned_sessions p
            LEFT JOIN public.training_blocks b ON b.id=p.block_id AND b.user_id=u
            WHERE p.session_id=workout.id AND p.user_id=u AND (b.id IS NULL OR b.program_kind IS NOT NULL))) THEN
        RAISE EXCEPTION 'A workout suggestion is available for this lift. Reload Today.' USING ERRCODE='40001';
      END IF;
      proposed:=suggestion.suggested_tm_kg;
    ELSE
      IF NOT EXISTS(SELECT 1 FROM public.sessions s
        WHERE s.id=suggestion.derived_from_session_id AND s.user_id=u
          AND NOT EXISTS(SELECT 1 FROM public.planned_sessions p
            LEFT JOIN public.training_blocks b ON b.id=p.block_id AND b.user_id=u
            WHERE p.session_id=s.id AND p.user_id=u AND (b.id IS NULL OR b.program_kind IS NOT NULL))) THEN
        RAISE EXCEPTION 'Review the load settings in this workout''s program.' USING ERRCODE='42501';
      END IF;
      effective_percent:=COALESCE(current_max.tm_percent,default_percent);
      proposed:=round((suggestion.suggested_tm_kg*100/effective_percent)/2.5)*2.5;
    END IF;
    IF p_accept THEN
      UPDATE public.training_maxes SET one_rm_kg=proposed,source=suggestion.source,
        derived_from_session_id=suggestion.derived_from_session_id,derived_from_set_log_id=suggestion.derived_from_set_log_id,
        derived_formula=suggestion.derived_formula,derived_at=CASE WHEN suggestion.source='scheduled_progression' THEN NULL ELSE now() END
        WHERE user_id=u AND id=current_max.id;
      IF suggestion.source<>'scheduled_progression' THEN
        INSERT INTO public.tm_history(user_id,movement_id,old_tm_kg,new_tm_kg,reason,session_id,trigger_key)
          VALUES(u,suggestion.movement_id,suggestion.current_tm_kg,suggestion.suggested_tm_kg,'amrap_bump',
            suggestion.derived_from_session_id,'suggestion:'||suggestion.id::text);
      END IF;
    END IF;
    -- Resolving the visible winner also retires hidden advice for the same lift.
    UPDATE public.tm_suggestions SET status=CASE WHEN id=suggestion.id AND p_accept THEN 'accepted' ELSE 'dismissed' END,
      resolved_at=now() WHERE user_id=u AND movement_id=suggestion.movement_id AND status='pending';
    processed:=processed+1;
  END LOOP;
  RETURN processed;
END $$;
REVOKE ALL ON FUNCTION public.decide_max_suggestions(uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_max_suggestions(uuid[],boolean) TO authenticated;

CREATE FUNCTION public.set_scheduled_max_progression(p_enabled boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose a setting.' USING ERRCODE='22023'; END IF;
  UPDATE public.profiles SET intake=jsonb_set(intake,'{suggestScheduled1RmIncreases}',to_jsonb(p_enabled)) WHERE id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your settings are unavailable.' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_scheduled_max_progression(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_scheduled_max_progression(boolean) TO authenticated;
