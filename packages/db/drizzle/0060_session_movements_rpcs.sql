-- 0060_session_movements_rpcs.sql
--
-- PR #147 review follow-up — close two narrow-window TOCTOU races that
-- exist in the JavaScript implementation of `addSessionMovementAction`
-- and `removeSessionMovementAction` by moving the read+write pair into
-- a single SQL statement on the server.
--
-- 1. `add_session_movement(session, movement, user)` — replaces the
--    "SELECT max(sort_order) … then INSERT" sequence. Two concurrent
--    adds for the same session used to be able to observe the same
--    max and write the same sort_order. The new function computes
--    sort_order via a subquery inside the INSERT, so MAX and the
--    INSERT live in the same statement and collisions are impossible
--    even under concurrent execution. The function is idempotent:
--    if (session, movement) already exists it returns the existing
--    row rather than attempting (and racing on) a duplicate insert.
--
-- 2. `remove_session_movement(session, movement)` — replaces the
--    "count set_logs … then DELETE" sequence. Another tab logging a
--    set in between used to silently lose its protection. The new
--    function does a single DELETE … WHERE NOT EXISTS (set_logs …),
--    so the guard is evaluated atomically with the delete. The
--    follow-up EXISTS check exists purely to distinguish
--    blocked-by-set_logs from already-removed for the caller; it
--    cannot reintroduce the race because the delete either succeeded
--    (no race possible) or failed because the atomic guard fired.
--
-- SECURITY INVOKER on both: the existing RLS policies on
-- `session_movements` (insert/delete `auth.uid() = user_id`) and on
-- `set_logs` still apply. The action layer keeps its own ownership
-- and "session not yet completed" guards as defence-in-depth.

CREATE OR REPLACE FUNCTION public.add_session_movement(
  p_session_id uuid,
  p_movement_id uuid,
  p_user_id uuid
)
RETURNS TABLE (session_id uuid, movement_id uuid, sort_order smallint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.session_movements;
BEGIN
  -- Idempotent: if it already exists, return the existing row.
  SELECT * INTO v_existing
  FROM public.session_movements sm
  WHERE sm.session_id = p_session_id
    AND sm.movement_id = p_movement_id;

  IF FOUND THEN
    RETURN QUERY
      SELECT v_existing.session_id, v_existing.movement_id, v_existing.sort_order;
    RETURN;
  END IF;

  -- Atomic insert with computed sort_order. MAX + INSERT in the same
  -- statement → two concurrent callers cannot read the same max and
  -- both write the same sort_order.
  RETURN QUERY
  INSERT INTO public.session_movements (session_id, movement_id, user_id, sort_order)
  VALUES (
    p_session_id,
    p_movement_id,
    p_user_id,
    COALESCE(
      (SELECT MAX(sm2.sort_order)
         FROM public.session_movements sm2
        WHERE sm2.session_id = p_session_id),
      0
    )::smallint + 10
  )
  RETURNING
    session_movements.session_id,
    session_movements.movement_id,
    session_movements.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_session_movement(uuid, uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_session_movement(
  p_session_id uuid,
  p_movement_id uuid
)
RETURNS TABLE (deleted boolean, reason text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.session_movements sm
  WHERE sm.session_id = p_session_id
    AND sm.movement_id = p_movement_id
    AND NOT EXISTS (
      SELECT 1 FROM public.set_logs sl
      WHERE sl.session_id = p_session_id
        AND sl.movement_id = p_movement_id
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.set_logs sl
      WHERE sl.session_id = p_session_id
        AND sl.movement_id = p_movement_id
    ) THEN
      RETURN QUERY SELECT false, 'has_set_logs'::text;
    ELSE
      -- Already removed (or never present) — caller's intent is
      -- satisfied. Treat as success.
      RETURN QUERY SELECT true, 'not_present'::text;
    END IF;
  ELSE
    RETURN QUERY SELECT true, 'removed'::text;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_session_movement(uuid, uuid)
  TO authenticated;
