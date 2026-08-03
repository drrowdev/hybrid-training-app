-- Remove one network round-trip from every set log and batch session-history
-- hints into one RLS-protected query.

CREATE OR REPLACE FUNCTION public.assign_set_log_index()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Serialise index allocation per session. The advisory lock is transaction-
  -- scoped, so concurrent tabs/devices cannot read the same MAX(set_index).
  -- Always replace a client-supplied value: the database owns this ordering.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.session_id::text, 0));

  SELECT COALESCE(MAX(sl.set_index) + 1, 0)::smallint
    INTO NEW.set_index
    FROM public.set_logs sl
   WHERE sl.session_id = NEW.session_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_logs_assign_set_index ON public.set_logs;
CREATE TRIGGER set_logs_assign_set_index
  BEFORE INSERT ON public.set_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_set_log_index();

CREATE OR REPLACE FUNCTION public.last_sets_for_movements(
  p_movement_ids uuid[],
  p_user_id uuid,
  p_exclude_session_id uuid DEFAULT NULL
)
RETURNS TABLE (
  movement_id uuid,
  weight_kg numeric,
  reps smallint,
  rpe numeric,
  performed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    requested.movement_id,
    best.weight_kg,
    best.reps,
    best.rpe,
    latest.performed_at
  FROM unnest(p_movement_ids) AS requested(movement_id)
  CROSS JOIN LATERAL (
    SELECT s.id, s.performed_at
    FROM public.sessions s
    JOIN public.set_logs sl
      ON sl.session_id = s.id
     AND sl.movement_id = requested.movement_id
     AND sl.skipped = false
     AND sl.set_kind <> 'warmup'
     AND sl.weight_kg IS NOT NULL
     AND sl.reps IS NOT NULL
     AND sl.reps > 0
    WHERE s.user_id = p_user_id
      AND s.deleted_at IS NULL
      AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
    ORDER BY s.performed_at DESC
    LIMIT 1
  ) latest
  CROSS JOIN LATERAL (
    SELECT sl.weight_kg, sl.reps, sl.rpe
    FROM public.set_logs sl
    WHERE sl.session_id = latest.id
      AND sl.movement_id = requested.movement_id
      AND sl.skipped = false
      AND sl.set_kind <> 'warmup'
      AND sl.weight_kg IS NOT NULL
      AND sl.reps IS NOT NULL
      AND sl.reps > 0
    ORDER BY sl.weight_kg DESC, sl.reps DESC, sl.created_at DESC
    LIMIT 1
  ) best;
$$;

GRANT EXECUTE ON FUNCTION public.last_sets_for_movements(uuid[], uuid, uuid)
  TO authenticated;

-- The BW gate loader uses `prerequisites && node_ids`.
CREATE INDEX IF NOT EXISTS movement_nodes_prerequisites_gin
  ON public.movement_nodes USING gin (prerequisites);
