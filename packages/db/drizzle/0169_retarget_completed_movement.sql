-- Changing the movement of a finished workout.
--
-- A finished workout keeps its issued prescription (guard_program_prescription), so the
-- movement can't be changed with a plain update. This function changes it in one
-- transaction: the logged sets, the freestyle movement list and the prescription items
-- that carry the movement. The guard itself is left as it is (earlier migrations pin its
-- body); the prescription is updated while the workout is briefly marked unfinished inside
-- the same transaction, so no other session ever sees that state and the original
-- completion time is restored before the function returns.
--
-- Refused: swimming workouts, and movements whose bodyweight progress was already
-- credited from a logged set (that credit belongs to the original movement).
CREATE FUNCTION public.retarget_completed_movement(p_session_id uuid, p_original_movement_id uuid, p_new_movement_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  u uuid := auth.uid();
  finished timestamptz; planned_id uuid; planned_rx jsonb; session_rx jsonb;
  replacement record; updated_sets integer := 0; changed boolean := false;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501'; END IF;
  IF p_original_movement_id = p_new_movement_id THEN
    RAISE EXCEPTION 'Choose a different movement.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  SELECT completed_at, prescription INTO finished, session_rx FROM public.sessions
    WHERE id = p_session_id AND user_id = u AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workout is no longer available to edit.' USING ERRCODE = '42501'; END IF;
  IF finished IS NULL THEN RAISE EXCEPTION 'Only a finished workout can be changed this way.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.swim_workouts WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'Use the swimming result editor for this session.' USING ERRCODE = '22023';
  END IF;
  SELECT id, slug, display_name INTO replacement FROM public.movements
    WHERE id = p_new_movement_id AND (user_id IS NULL OR user_id = u);
  IF NOT FOUND THEN RAISE EXCEPTION 'Replacement movement not found.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.bw_set_progress_contributions c
      JOIN public.set_logs s ON s.id = c.set_log_id
      WHERE s.session_id = p_session_id AND s.movement_id = p_original_movement_id) THEN
    RAISE EXCEPTION 'Bodyweight progress was already credited from this movement.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.set_logs SET movement_id = p_new_movement_id
    WHERE session_id = p_session_id AND movement_id = p_original_movement_id;
  GET DIAGNOSTICS updated_sets = ROW_COUNT;
  changed := updated_sets > 0;

  INSERT INTO public.session_movements (session_id, movement_id, user_id, sort_order)
    SELECT session_id, p_new_movement_id, user_id, sort_order FROM public.session_movements
    WHERE session_id = p_session_id AND movement_id = p_original_movement_id AND user_id = u
    ON CONFLICT DO NOTHING;
  DELETE FROM public.session_movements
    WHERE session_id = p_session_id AND movement_id = p_original_movement_id AND user_id = u;

  IF session_rx IS NOT NULL AND jsonb_typeof(session_rx->'items') = 'array'
     AND jsonb_path_exists(session_rx, '$.items[*] ? (@.movementId == $id)', jsonb_build_object('id', p_original_movement_id::text)) THEN
    UPDATE public.sessions SET prescription = jsonb_set(session_rx, '{items}', (
      SELECT jsonb_agg(CASE WHEN item->>'movementId' = p_original_movement_id::text THEN
        item || jsonb_build_object('movementId', replacement.id, 'movementSlug', replacement.slug, 'movementName', replacement.display_name,
          'meta', COALESCE(item->'meta', '{}'::jsonb) || jsonb_build_object('retargetedFrom', p_original_movement_id))
        ELSE item END ORDER BY ord)
      FROM jsonb_array_elements(session_rx->'items') WITH ORDINALITY AS t(item, ord)))
      WHERE id = p_session_id AND user_id = u;
    changed := true;
  END IF;

  SELECT id, prescription INTO planned_id, planned_rx FROM public.planned_sessions
    WHERE completed_session_id = p_session_id AND user_id = u FOR UPDATE;
  IF FOUND AND planned_rx IS NOT NULL AND jsonb_typeof(planned_rx->'items') = 'array'
     AND jsonb_path_exists(planned_rx, '$.items[*] ? (@.movementId == $id)', jsonb_build_object('id', p_original_movement_id::text)) THEN
    UPDATE public.sessions SET completed_at = NULL WHERE id = p_session_id AND user_id = u;
    UPDATE public.planned_sessions SET prescription = jsonb_set(planned_rx, '{items}', (
      SELECT jsonb_agg(CASE WHEN item->>'movementId' = p_original_movement_id::text THEN
        item || jsonb_build_object('movementId', replacement.id, 'movementSlug', replacement.slug, 'movementName', replacement.display_name,
          'meta', COALESCE(item->'meta', '{}'::jsonb) || jsonb_build_object('retargetedFrom', p_original_movement_id))
        ELSE item END ORDER BY ord)
      FROM jsonb_array_elements(planned_rx->'items') WITH ORDINALITY AS t(item, ord)))
      WHERE id = planned_id AND user_id = u;
    UPDATE public.sessions SET completed_at = finished WHERE id = p_session_id AND user_id = u;
    changed := true;
  END IF;

  IF NOT changed THEN RAISE EXCEPTION 'That movement is not in this workout.' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('sets', updated_sets, 'movement',
    jsonb_build_object('id', replacement.id, 'slug', replacement.slug, 'displayName', replacement.display_name));
END $$;
REVOKE ALL ON FUNCTION public.retarget_completed_movement(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retarget_completed_movement(uuid, uuid, uuid) TO authenticated;
