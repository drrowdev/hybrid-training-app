-- 0053_perf_indexes.sql
--
-- Performance audit follow-up — fill in two missing indexes flagged in
-- `hybrid-perf-audit.md` (Database → Missing / suspect indexes).
--
-- 1. planned_sessions.completed_session_id
--    Used by `/app/sessions/[id]/page.tsx` (`.eq('completed_session_id', id)`)
--    on every session detail render, and by the deload flow which walks
--    recent planned sessions joined back to their completed counterpart
--    (`lib/engine/deload.ts`). Before this index the lookup was a full
--    scan of planned_sessions per request. Partial index — null rows
--    (uncompleted planned sessions) are excluded so the index stays
--    small.
--
-- 2. set_logs (movement_id, created_at DESC)
--    Backs PR detection (`lib/stats/pr-queries.ts`),
--    movement-history queries (`lib/stats/movement.ts`), and the
--    prior-bests fetch on the session detail page. The existing
--    `set_logs_movement_idx` is on `movement_id` alone, so ordered
--    scans had to sort up to 500 rows in memory. set_logs has no
--    `performed_at` column (that lives on `sessions`); `created_at` is
--    set at insert time and tracks the session's `performed_at`
--    closely enough to drive index-only scans for "latest N rows for
--    these movements".
--
-- Both `CREATE INDEX IF NOT EXISTS` so the migration is safe to re-run
-- (idempotency baseline, per `packages/db/README.md`). Index creations
-- are non-blocking enough at our row counts that we don't need
-- `CONCURRENTLY`; if the table ever grows past a few million rows we
-- can switch to a concurrent rebuild.

CREATE INDEX IF NOT EXISTS planned_sessions_completed_session_idx
  ON public.planned_sessions (completed_session_id)
  WHERE completed_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS set_logs_movement_created_at_idx
  ON public.set_logs (movement_id, created_at DESC);
