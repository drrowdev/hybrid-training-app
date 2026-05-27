-- 0061_session_movements_fix_ambiguous.sql
--
-- Replaces the add_session_movement function from migration 0060. The
-- previous version declared RETURNS TABLE (session_id uuid, ...), which
-- exposes session_id / movement_id / sort_order as local OUT-parameter
-- names inside the function body. Inside the INSERT...ON CONFLICT...
-- RETURNING statement, Postgres can't tell whether `session_id` (in
-- the conflict target) refers to the table column or the OUT param.
-- Runtime error: `column reference "session_id" is ambiguous`.
--
-- Two changes here:
--  1. Rename the OUT params to `out_*` so they don't collide.
--  2. Alias the INSERT target table as `sm` so the ON CONFLICT DO UPDATE
--     SET and RETURNING clauses can reference table columns
--     unambiguously.
--
-- Function signature (name + arg types) is unchanged, so the GRANT
-- EXECUTE from 0060 still applies and the client-side .rpc() call
-- doesn't need to change. Return shape changes from
-- (session_id, movement_id, sort_order) → (out_session_id, ...) but
-- the action layer doesn't read the returned fields, only the error.

-- Postgres rejects CREATE OR REPLACE when the OUT parameter row
-- type differs. DROP first, then recreate.
DROP FUNCTION IF EXISTS public.add_session_movement(uuid, uuid, uuid);

CREATE FUNCTION public.add_session_movement(
  p_session_id uuid,
  p_movement_id uuid,
  p_user_id uuid
)
RETURNS TABLE (out_session_id uuid, out_movement_id uuid, out_sort_order smallint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.session_movements AS sm
    (session_id, movement_id, user_id, sort_order)
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
  ON CONFLICT (session_id, movement_id) DO UPDATE
    SET sort_order = sm.sort_order
  RETURNING sm.session_id, sm.movement_id, sm.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_session_movement(uuid, uuid, uuid)
  TO authenticated;
