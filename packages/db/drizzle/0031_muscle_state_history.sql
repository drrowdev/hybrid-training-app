-- 0031_muscle_state_history.sql
--
-- Daily snapshots of per-muscle freshness, captured by the same
-- /api/cron/region-state-snapshot Vercel cron at 03:00 UTC. Read by
-- the muscle-grid component (`getMuscleFreshness`) to draw the
-- 16-muscle freshness body diagram without re-walking `set_logs` on
-- every page visit.
--
-- ## Why a separate table from region_state_history (0029)?
--
-- The 7-region freshness model (DC-A6) is kept intact — the planner,
-- engine, and existing soft-warning gates all read from it. The
-- 16-muscle grid is an additive surface (`/app/freshness`,
-- /app/stats/wellness) with a finer resolution that maps to what the
-- user "sees" in the mirror (Quads, Hamstrings, Glutes, Calves, Core,
-- Chest, Back, Lats, Traps, Shoulders, Biceps, Triceps, Forearms,
-- Obliques, Erectors, Adductors). Storing both keeps the migration
-- cost zero for everything downstream of regions.
--
-- ## Schema shape — mirrors region_state_history
--
-- Same composite primary key (user_id, muscle, snapshot_date), same
-- numeric(5,4) freshness scale, same `context` JSONB blob (audit-only,
-- not engine-observable per plan §6.8).
--
-- Read path:
--   - The grid reads the most-recent row per muscle.
--   - "Today not yet snapshotted" → the read path computes today live
--     from set_logs + cardio_logs and uses that value directly.
--
-- Write path:
--   - The existing 03:00 UTC cron loops users × muscles and UPSERTs
--     today's row alongside the region snapshots. One handler, one
--     iteration, two tables.

CREATE TABLE IF NOT EXISTS public.muscle_state_history (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muscle text NOT NULL,
  snapshot_date date NOT NULL,
  -- Freshness in [0.0000, 1.0000] — same scale as
  -- domain/computeRegionFreshness (DC-C14). 1 = fully fresh, 0 =
  -- heavily loaded.
  freshness_score numeric(5, 4) NOT NULL,
  -- Days since the muscle was last loaded (any non-zero contribution
  -- from a strength set or a cardio modality mapping). Null = never.
  days_since_loaded smallint,
  -- Most-recent load date (YYYY-MM-DD) — duplicated from context for
  -- index-only reads.
  last_load_date date,
  -- Audit blob — loose shape on purpose:
  --   { sets_7d, sets_14d, sets_28d, atl, baseline, top_movements }
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, muscle, snapshot_date)
);

CREATE INDEX IF NOT EXISTS muscle_state_history_user_date_idx
  ON public.muscle_state_history (user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS muscle_state_history_user_muscle_idx
  ON public.muscle_state_history (user_id, muscle, snapshot_date DESC);

ALTER TABLE public.muscle_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS muscle_state_history_self ON public.muscle_state_history;
CREATE POLICY muscle_state_history_self
  ON public.muscle_state_history
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.muscle_state_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.muscle_state_history TO service_role;
