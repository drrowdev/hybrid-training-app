-- 0047_bw_diagnostics_snapshots.sql
--
-- Phase 6 of the bodyweight progression plan — stall + drift
-- detection. Persists a JSONB snapshot of `runDiagnostics` output
-- per user, taken at:
--   1. Session completion (the server action right after the BW
--      side-effects hook runs).
--   2. Block creation (createBlock / createCustomBlock).
--
-- Why a dedicated table instead of stamping onto sessions /
-- training_blocks:
--   - Both write paths need the same shape; co-locating keeps the
--     "diagnostics changed over time" chart query simple.
--   - The output is small but variable (0–7 cards × ~3 fields), and
--     it is *output* of a pure function over already-stored rows.
--     Storing the derived snapshot avoids re-running ~4 queries on
--     every dashboard page load.
--   - Schema discipline (plan §6.8): the snapshot is read as a
--     whole — the dashboard reads "latest snapshot for user",
--     never "filter by signal kind across users". A JSONB column
--     is the right shape, not a wide signals table.
--
-- Retention: capped at 100 rows per user. The writer deletes
-- older rows in the same transaction (see
-- `apps/web/src/lib/planner/bw-diagnostics-snapshot.ts`). 100 ≈
-- 3 months of two-session weeks plus a buffer for block
-- creations — enough to see drift, not enough to bloat the table.
--
-- RLS: self-only read, no insert/update/delete policies — writes
-- run server-side under the user's session, the policy shape mirrors
-- bw_progression_events (the same self-write pattern).
CREATE TABLE IF NOT EXISTS public.bw_diagnostics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bw_diagnostics_snapshots_user_taken_idx
  ON public.bw_diagnostics_snapshots(user_id, taken_at DESC);

ALTER TABLE public.bw_diagnostics_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_diagnostics_snapshots'
      AND policyname = 'bw_diagnostics_snapshots_self_read'
  ) THEN
    CREATE POLICY "bw_diagnostics_snapshots_self_read"
      ON public.bw_diagnostics_snapshots FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_diagnostics_snapshots'
      AND policyname = 'bw_diagnostics_snapshots_self_write'
  ) THEN
    CREATE POLICY "bw_diagnostics_snapshots_self_write"
      ON public.bw_diagnostics_snapshots FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bw_diagnostics_snapshots'
      AND policyname = 'bw_diagnostics_snapshots_self_delete'
  ) THEN
    -- Retention cap is enforced application-side via a DELETE that
    -- runs in the same transaction as the INSERT. Allow self-delete
    -- so the cap query doesn't need a service-role escape hatch.
    CREATE POLICY "bw_diagnostics_snapshots_self_delete"
      ON public.bw_diagnostics_snapshots FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
