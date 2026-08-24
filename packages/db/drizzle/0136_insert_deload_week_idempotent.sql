-- 0136_insert_deload_week_idempotent.sql
-- ─────────────────────────────────────────────────────────────────────
-- Post-peak recovery prompt — make `insert_deload_week` safe to call twice.
--
-- 0106 renumbers weeks and inserts sessions with no serialisation of its own.
-- Two concurrent calls (a double-tap, a retried server action, the same prompt
-- open in two tabs) therefore both shift and both insert, leaving two recovery
-- weeks and a block two weeks longer. The recovery prompt makes that a realistic
-- path rather than a theoretical one, so:
--
--   1. Take a row lock on the block first. The second caller waits, then sees
--      the first caller's committed state instead of racing it.
--   2. Refuse when the target position already holds a deload week. Returning
--      the existing week index (rather than raising) keeps the caller's success
--      path intact — pressing the button twice gets you one recovery week.
--
-- Also allows p_after_week = -1, which prepends the recovery week before week 0.
-- TB3 advises a deload BETWEEN blocks; when the peak week is the last week of
-- the plan, the only place that week can go is the front of what comes next.
--
-- Note on the duplicate check: `role = 'deload'` is NOT a marker for an inserted
-- recovery week — every program tags its OWN programmed deload week with it
-- (5/3/1's 7th week, Green's phase-grid deloads, Hybrid's deload week). Guarding
-- on role alone would make the always-available "take a recovery week" control a
-- silent no-op for anyone standing the week before their programmed deload. The
-- inserted week is therefore stamped with `prescription.insertedRecoveryWeek`,
-- and that is what the guard reads.
--
-- Behaviour is otherwise identical to 0106, including the +1000 temp-offset
-- renumber that dodges the (block_id, week_index, day_index, slot) unique index.

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
  -- Ownership + state, and serialise concurrent inserts on this block.
  SELECT weeks INTO v_weeks
    FROM public.training_blocks
   WHERE id = p_block_id
     AND user_id = p_user_id
     AND deleted_at IS NULL
     AND status = 'active'
     FOR UPDATE;
  IF v_weeks IS NULL THEN
    RAISE EXCEPTION 'block % not found, not owned, or not active', p_block_id;
  END IF;

  -- -1 prepends before week 0; otherwise an existing week (0 .. weeks-1).
  IF p_after_week < -1 OR p_after_week > v_weeks - 1 THEN
    RAISE EXCEPTION 'after_week % out of range (block has % weeks)', p_after_week, v_weeks;
  END IF;

  IF p_sessions IS NULL OR jsonb_array_length(p_sessions) = 0 THEN
    RAISE EXCEPTION 'deload week has no sessions';
  END IF;

  v_new_week := p_after_week + 1;

  -- Already done: an unlogged week INSERTED BY THIS FUNCTION sits exactly where
  -- this one would go. A program's own programmed deload week does not count.
  IF EXISTS (
    SELECT 1 FROM public.planned_sessions
     WHERE block_id = p_block_id
       AND user_id = p_user_id
       AND week_index = v_new_week
       AND role = 'deload'
       AND completed_session_id IS NULL
       AND prescription->>'insertedRecoveryWeek' = 'true'
  ) THEN
    RETURN v_new_week;
  END IF;

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
    -- Provenance: marks this week as one THIS function inserted, so a repeat
    -- call is a no-op while a program's own deload week is left alone.
    (s->'prescription') || '{"insertedRecoveryWeek": true}'::jsonb,
    NULLIF(s->>'session_modality', '')
  FROM jsonb_array_elements(p_sessions) AS s;

  -- The block is now one week longer.
  UPDATE public.training_blocks
     SET weeks = weeks + 1, updated_at = now()
   WHERE id = p_block_id AND user_id = p_user_id;

  RETURN v_new_week;
END;
$$;
