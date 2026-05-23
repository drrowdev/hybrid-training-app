-- 0029_region_state_history.sql
--
-- Daily snapshots of per-region freshness, captured by the
-- /api/cron/region-state-snapshot Vercel cron at 03:00 UTC. Read by
-- the engine page (`getRegionFreshnessDetail`) to draw the 14-day
-- strip without re-walking `set_logs` on every request.
--
-- Why a separate history table (vs. amending `region_state`):
--   - `region_state` (migration 0005) holds the *current* per-region
--     EWMA snapshot — primary key (user_id, region) — and is rewritten
--     in place by `recomputeRegionState()`. A timeseries needs a third
--     key column (snapshot_date) and append-mostly semantics.
--   - Keeping them separate means the current-snapshot writer doesn't
--     have to also produce history, and the history retention policy
--     can evolve independently of the engine ledger.
--
-- Read path:
--   - The engine page reads the last 14 daily rows per region.
--   - "Today not yet snapshotted" is the common case until the 03:00
--     cron fires — the read path computes today live and prepends.
--
-- Write path:
--   - Cron loops users × regions and UPSERTs today's row.
--   - One-shot backfill script in `packages/db/scripts/` populates the
--     last 30 days from existing `set_logs` for current users.
--
-- Schema discipline (plan §6.8): `context` is a JSONB blob —
-- `{ sets_7d, sets_14d, sets_28d, last_hit_date, atl, baseline }`. It's
-- audit/analytics-only, not observable from the engine. No top-level
-- column per the discipline guard rails.

CREATE TABLE IF NOT EXISTS public.region_state_history (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  region text NOT NULL,
  snapshot_date date NOT NULL,
  -- Freshness in [0.0000, 1.0000] — same scale as
  -- domain/computeRegionFreshness (DC-C14).
  freshness_score numeric(5, 4) NOT NULL,
  -- Engine context at snapshot time. Loose shape on purpose.
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, region, snapshot_date)
);

CREATE INDEX IF NOT EXISTS region_state_history_user_date_idx
  ON public.region_state_history (user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS region_state_history_user_region_idx
  ON public.region_state_history (user_id, region, snapshot_date DESC);

ALTER TABLE public.region_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS region_state_history_self ON public.region_state_history;
CREATE POLICY region_state_history_self
  ON public.region_state_history
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_state_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.region_state_history TO service_role;
