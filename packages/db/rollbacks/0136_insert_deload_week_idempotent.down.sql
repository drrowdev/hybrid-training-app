-- Rollback 0136 — restore the 0106 definition of insert_deload_week.
--
-- Drops the block lock, the duplicate-position guard, and prepend support.
-- Safe to run: a recovery week already inserted at week 0 stays where it is;
-- only future calls lose the ability to create one there.

CREATE OR REPLACE FUNCTION public.insert_deload_week(
  p_block_id uuid,
  p_user_id uuid,
  p_after_week int,
  p_sessions jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weeks int;
  v_new_week int;
BEGIN
  SELECT weeks INTO v_weeks
    FROM public.training_blocks
   WHERE id = p_block_id
     AND user_id = p_user_id
     AND deleted_at IS NULL
     AND status = 'active';
  IF v_weeks IS NULL THEN
    RAISE EXCEPTION 'block % not found, not owned, or not active', p_block_id;
  END IF;

  IF p_after_week < 0 OR p_after_week > v_weeks - 1 THEN
    RAISE EXCEPTION 'after_week % out of range (block has % weeks)', p_after_week, v_weeks;
  END IF;

  IF p_sessions IS NULL OR jsonb_array_length(p_sessions) = 0 THEN
    RAISE EXCEPTION 'deload week has no sessions';
  END IF;

  v_new_week := p_after_week + 1;

  UPDATE public.planned_sessions
     SET week_index = week_index + 1000
   WHERE block_id = p_block_id
     AND user_id = p_user_id
     AND week_index > p_after_week;
  UPDATE public.planned_sessions
     SET week_index = week_index - 999
   WHERE block_id = p_block_id
     AND user_id = p_user_id
     AND week_index > p_after_week + 1000;

  INSERT INTO public.planned_sessions
    (block_id, user_id, week_index, day_index, slot, title, role, prescription, session_modality)
  SELECT
    p_block_id,
    p_user_id,
    v_new_week::smallint,
    (s->>'day_index')::smallint,
    (COALESCE(NULLIF(s->>'slot', ''), 'single'))::session_slot,
    s->>'title',
    'deload',
    s->'prescription',
    NULLIF(s->>'session_modality', '')
  FROM jsonb_array_elements(p_sessions) AS s;

  UPDATE public.training_blocks
     SET weeks = weeks + 1, updated_at = now()
   WHERE id = p_block_id AND user_id = p_user_id;

  RETURN v_new_week;
END;
$$;
