-- 0054_prior_bests_rpc.sql
--
-- Perf audit F11 — push the prior-bests aggregation into Postgres.
--
-- /app/sessions/[id] used to pull up to 500 raw `set_logs` rows and
-- compute MAX(weight_kg) + MAX(conservative_e1rm) per movement in
-- JavaScript. This migration adds two SECURITY INVOKER functions so the
-- aggregation runs server-side and the page receives N rows (one per
-- movement) instead of 500.
--
-- 1. `conservative_e1rm(weight, reps, rpe)` — pure helper that mirrors
--    `lib/engine/one-rm.ts::bestEstimateOneRm` exactly:
--      * Epley = weight × (1 + reps/30), valid for reps 1..12.
--      * RPE-based = weight ÷ Helms/Zourdos chart cell, valid for
--        reps 1..12 and RPE snapped to a 0.5 step in [6.0, 10.0].
--      * Returns LEAST(epley, rpe-based) when both are available
--        (conservative — PRs are hard to fake on a grinder set where
--        the lifter underestimates RPE); falls back to Epley alone
--        when no RPE is logged; returns NULL outside the formula's
--        valid window.
--
-- 2. `prior_bests_for_movements(movement_ids, user_id, cutoff)` — runs
--    the same filters the old JS code applied (warmups excluded;
--    sessions.user_id match; sessions.deleted_at IS NULL; weight_kg
--    and reps present and > 0; sessions.performed_at strictly before
--    the cutoff) and aggregates max weight + max conservative e1RM
--    per movement.
--
-- SECURITY INVOKER + RLS: both functions run as the caller, so the
-- existing RLS policies on `set_logs` and `sessions` still apply. The
-- explicit `user_id` filter inside the function is belt-and-braces —
-- it makes the predicate visible to the planner so the query never
-- scans rows the caller couldn't read anyway.
--
-- GRANT EXECUTE TO authenticated — anon must never call these; service
-- role inherits execute by default.

CREATE OR REPLACE FUNCTION public.conservative_e1rm(
  weight numeric,
  reps integer,
  rpe numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  epley numeric;
  snapped numeric;
  pct numeric;
  rpe_based numeric;
BEGIN
  -- Epley window: weight > 0, reps integer 1..12.
  IF weight IS NULL OR reps IS NULL OR weight <= 0 OR reps < 1 OR reps > 12 THEN
    RETURN NULL;
  END IF;
  epley := weight * (1 + reps::numeric / 30);

  -- No RPE logged → Epley alone.
  IF rpe IS NULL THEN
    RETURN epley;
  END IF;

  -- Snap RPE to nearest 0.5; reject anything outside [6.0, 10.0].
  snapped := round(rpe * 2) / 2.0;
  IF snapped < 6.0 OR snapped > 10.0 THEN
    RETURN epley;
  END IF;

  -- Helms / Zourdos %1RM chart (reps × RPE).
  pct := CASE reps
    WHEN 1 THEN CASE snapped
      WHEN 6.0 THEN 0.860 WHEN 6.5 THEN 0.867 WHEN 7.0 THEN 0.880
      WHEN 7.5 THEN 0.893 WHEN 8.0 THEN 0.910 WHEN 8.5 THEN 0.925
      WHEN 9.0 THEN 0.955 WHEN 9.5 THEN 0.978 WHEN 10.0 THEN 1.000 END
    WHEN 2 THEN CASE snapped
      WHEN 6.0 THEN 0.838 WHEN 6.5 THEN 0.846 WHEN 7.0 THEN 0.860
      WHEN 7.5 THEN 0.872 WHEN 8.0 THEN 0.886 WHEN 8.5 THEN 0.910
      WHEN 9.0 THEN 0.925 WHEN 9.5 THEN 0.955 WHEN 10.0 THEN 0.978 END
    WHEN 3 THEN CASE snapped
      WHEN 6.0 THEN 0.815 WHEN 6.5 THEN 0.824 WHEN 7.0 THEN 0.838
      WHEN 7.5 THEN 0.851 WHEN 8.0 THEN 0.864 WHEN 8.5 THEN 0.886
      WHEN 9.0 THEN 0.910 WHEN 9.5 THEN 0.925 WHEN 10.0 THEN 0.955 END
    WHEN 4 THEN CASE snapped
      WHEN 6.0 THEN 0.794 WHEN 6.5 THEN 0.803 WHEN 7.0 THEN 0.815
      WHEN 7.5 THEN 0.829 WHEN 8.0 THEN 0.840 WHEN 8.5 THEN 0.860
      WHEN 9.0 THEN 0.886 WHEN 9.5 THEN 0.910 WHEN 10.0 THEN 0.925 END
    WHEN 5 THEN CASE snapped
      WHEN 6.0 THEN 0.774 WHEN 6.5 THEN 0.783 WHEN 7.0 THEN 0.794
      WHEN 7.5 THEN 0.806 WHEN 8.0 THEN 0.819 WHEN 8.5 THEN 0.840
      WHEN 9.0 THEN 0.860 WHEN 9.5 THEN 0.886 WHEN 10.0 THEN 0.910 END
    WHEN 6 THEN CASE snapped
      WHEN 6.0 THEN 0.756 WHEN 6.5 THEN 0.762 WHEN 7.0 THEN 0.774
      WHEN 7.5 THEN 0.788 WHEN 8.0 THEN 0.799 WHEN 8.5 THEN 0.819
      WHEN 9.0 THEN 0.840 WHEN 9.5 THEN 0.860 WHEN 10.0 THEN 0.886 END
    WHEN 7 THEN CASE snapped
      WHEN 6.0 THEN 0.737 WHEN 6.5 THEN 0.744 WHEN 7.0 THEN 0.756
      WHEN 7.5 THEN 0.770 WHEN 8.0 THEN 0.781 WHEN 8.5 THEN 0.799
      WHEN 9.0 THEN 0.819 WHEN 9.5 THEN 0.840 WHEN 10.0 THEN 0.860 END
    WHEN 8 THEN CASE snapped
      WHEN 6.0 THEN 0.720 WHEN 6.5 THEN 0.727 WHEN 7.0 THEN 0.737
      WHEN 7.5 THEN 0.750 WHEN 8.0 THEN 0.763 WHEN 8.5 THEN 0.781
      WHEN 9.0 THEN 0.799 WHEN 9.5 THEN 0.819 WHEN 10.0 THEN 0.840 END
    WHEN 9 THEN CASE snapped
      WHEN 6.0 THEN 0.704 WHEN 6.5 THEN 0.711 WHEN 7.0 THEN 0.720
      WHEN 7.5 THEN 0.733 WHEN 8.0 THEN 0.746 WHEN 8.5 THEN 0.763
      WHEN 9.0 THEN 0.781 WHEN 9.5 THEN 0.799 WHEN 10.0 THEN 0.819 END
    WHEN 10 THEN CASE snapped
      WHEN 6.0 THEN 0.688 WHEN 6.5 THEN 0.695 WHEN 7.0 THEN 0.704
      WHEN 7.5 THEN 0.717 WHEN 8.0 THEN 0.730 WHEN 8.5 THEN 0.746
      WHEN 9.0 THEN 0.763 WHEN 9.5 THEN 0.781 WHEN 10.0 THEN 0.799 END
    WHEN 11 THEN CASE snapped
      WHEN 6.0 THEN 0.673 WHEN 6.5 THEN 0.680 WHEN 7.0 THEN 0.688
      WHEN 7.5 THEN 0.701 WHEN 8.0 THEN 0.714 WHEN 8.5 THEN 0.730
      WHEN 9.0 THEN 0.746 WHEN 9.5 THEN 0.763 WHEN 10.0 THEN 0.781 END
    WHEN 12 THEN CASE snapped
      WHEN 6.0 THEN 0.659 WHEN 6.5 THEN 0.665 WHEN 7.0 THEN 0.673
      WHEN 7.5 THEN 0.685 WHEN 8.0 THEN 0.698 WHEN 8.5 THEN 0.714
      WHEN 9.0 THEN 0.730 WHEN 9.5 THEN 0.746 WHEN 10.0 THEN 0.763 END
  END;

  -- Chart miss (shouldn't happen given the guards above) → Epley.
  IF pct IS NULL OR pct <= 0 THEN
    RETURN epley;
  END IF;

  rpe_based := weight / pct;
  RETURN LEAST(epley, rpe_based);
END;
$$;

GRANT EXECUTE ON FUNCTION public.conservative_e1rm(numeric, integer, numeric)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.prior_bests_for_movements(
  p_movement_ids uuid[],
  p_user_id uuid,
  p_cutoff timestamptz
)
RETURNS TABLE (
  movement_id uuid,
  max_weight numeric,
  max_e1rm numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
PARALLEL SAFE
AS $$
  SELECT
    sl.movement_id,
    MAX(sl.weight_kg) AS max_weight,
    MAX(public.conservative_e1rm(sl.weight_kg, sl.reps::int, sl.rpe)) AS max_e1rm
  FROM public.set_logs sl
  JOIN public.sessions s
    ON s.id = sl.session_id
   AND s.user_id = p_user_id
   AND s.deleted_at IS NULL
   AND s.performed_at < p_cutoff
  WHERE sl.movement_id = ANY(p_movement_ids)
    AND sl.set_kind <> 'warmup'
    AND sl.weight_kg IS NOT NULL
    AND sl.reps IS NOT NULL
    AND sl.reps > 0
  GROUP BY sl.movement_id;
$$;

GRANT EXECUTE ON FUNCTION public.prior_bests_for_movements(uuid[], uuid, timestamptz)
  TO authenticated;
