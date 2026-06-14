-- 0106_deload_week_rpcs.sql
-- ─────────────────────────────────────────────────────────────────────
-- ADR 0049 — user-initiated deload week (insert a standalone recovery week).
--
-- A deload is INSERTED as its own week (Green Protocol's placement model), not
-- an overwrite of an existing week — so no programmed training week is lost.
-- Session calendar dates are derived from started_on + week_index*7 + day_index,
-- so inserting only needs a week_index renumber (+1 for every week after the
-- insertion point) plus training_blocks.weeks += 1; no date column to rewrite.
--
-- The renumber runs under the unique index
--   planned_sessions_block_week_day_slot_unique_idx (block_id, week_index,
--   day_index, slot)
-- which a naive `week_index = week_index + 1` would transiently violate
-- mid-statement (non-deferrable). Both functions therefore shift via a large
-- temporary offset (+1000, well outside the smallint week range) and back, so
-- no two rows ever share a (week_index, day_index, slot) at any instant. A
-- plpgsql function body is a single implicit transaction, so the whole
-- operation is atomic.
--
-- SECURITY INVOKER: the existing RLS policies on planned_sessions /
-- training_blocks (auth.uid() = user_id) still apply; the explicit
-- `user_id = p_user_id` predicates + the ownership check are defence-in-depth,
-- matching 0060's pattern. The action layer keeps its own Zod + ownership guard.

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
  -- Ownership + state: active, non-deleted block owned by the caller.
  SELECT weeks INTO v_weeks
    FROM public.training_blocks
   WHERE id = p_block_id
     AND user_id = p_user_id
     AND deleted_at IS NULL
     AND status = 'active';
  IF v_weeks IS NULL THEN
    RAISE EXCEPTION 'block % not found, not owned, or not active', p_block_id;
  END IF;

  -- p_after_week must be an existing week (0 .. weeks-1).
  IF p_after_week < 0 OR p_after_week > v_weeks - 1 THEN
    RAISE EXCEPTION 'after_week % out of range (block has % weeks)', p_after_week, v_weeks;
  END IF;

  IF p_sessions IS NULL OR jsonb_array_length(p_sessions) = 0 THEN
    RAISE EXCEPTION 'deload week has no sessions';
  END IF;

  v_new_week := p_after_week + 1;

  -- Shift every later week up by one, via a temp offset to dodge the unique idx.
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

  -- Insert the deload week's sessions at the freed slot, role = 'deload'.
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

  -- The block is now one week longer.
  UPDATE public.training_blocks
     SET weeks = weeks + 1, updated_at = now()
   WHERE id = p_block_id AND user_id = p_user_id;

  RETURN v_new_week;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_deload_week(
  p_block_id uuid,
  p_user_id uuid,
  p_week_index int
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Ownership.
  IF NOT EXISTS (
    SELECT 1 FROM public.training_blocks
     WHERE id = p_block_id AND user_id = p_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'block % not found or not owned', p_block_id;
  END IF;

  -- Must actually be a deload week.
  IF NOT EXISTS (
    SELECT 1 FROM public.planned_sessions
     WHERE block_id = p_block_id AND user_id = p_user_id
       AND week_index = p_week_index AND role = 'deload'
  ) THEN
    RAISE EXCEPTION 'week % is not a deload week', p_week_index;
  END IF;

  -- Never delete logged history: refuse if any deload session was completed.
  IF EXISTS (
    SELECT 1 FROM public.planned_sessions
     WHERE block_id = p_block_id AND user_id = p_user_id
       AND week_index = p_week_index AND role = 'deload'
       AND completed_session_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'deload week % has logged sessions and cannot be removed', p_week_index;
  END IF;

  -- Drop the deload week's sessions.
  DELETE FROM public.planned_sessions
   WHERE block_id = p_block_id AND user_id = p_user_id
     AND week_index = p_week_index AND role = 'deload';

  -- Shift every later week down by one (temp offset to dodge the unique idx).
  UPDATE public.planned_sessions
     SET week_index = week_index + 1000
   WHERE block_id = p_block_id
     AND user_id = p_user_id
     AND week_index > p_week_index;
  UPDATE public.planned_sessions
     SET week_index = week_index - 1001
   WHERE block_id = p_block_id
     AND user_id = p_user_id
     AND week_index > p_week_index + 1000;

  -- The block is one week shorter.
  UPDATE public.training_blocks
     SET weeks = GREATEST(weeks - 1, 1), updated_at = now()
   WHERE id = p_block_id AND user_id = p_user_id;
END;
$$;
