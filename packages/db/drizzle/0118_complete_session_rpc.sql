-- Complete a session with one RLS-protected database round trip.

CREATE OR REPLACE FUNCTION public.complete_training_session(
  p_session_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH metrics AS (
    SELECT
      ROUND(
        SUM(sl.rpe * sl.weight_kg * sl.reps)
          FILTER (
            WHERE sl.rpe IS NOT NULL
              AND sl.weight_kg IS NOT NULL
              AND sl.reps IS NOT NULL
              AND sl.weight_kg > 0
              AND sl.reps > 0
          )
        /
        NULLIF(
          SUM(sl.weight_kg * sl.reps)
            FILTER (
              WHERE sl.rpe IS NOT NULL
                AND sl.weight_kg IS NOT NULL
                AND sl.reps IS NOT NULL
                AND sl.weight_kg > 0
                AND sl.reps > 0
            ),
          0
        ),
        1
      ) AS session_rpe,
      CASE
        WHEN COUNT(*) >= 2 THEN
          NULLIF(
            LEAST(
              180,
              ROUND(
                EXTRACT(EPOCH FROM (MAX(sl.created_at) - MIN(sl.created_at))) / 60
              )::integer
            ),
            0
          )
        ELSE NULL
      END AS duration_min
    FROM public.set_logs sl
    WHERE sl.session_id = p_session_id
      AND sl.skipped = false
  ),
  updated AS (
    UPDATE public.sessions s
       SET session_rpe = metrics.session_rpe,
           duration_min = metrics.duration_min,
           notes = p_notes,
           completed_at = now()
      FROM metrics
     WHERE s.id = p_session_id
       AND s.user_id = (SELECT auth.uid())
    RETURNING s.user_id
  )
  SELECT user_id FROM updated;
$$;

GRANT EXECUTE ON FUNCTION public.complete_training_session(uuid, text)
  TO authenticated;
