-- 0026_soft_delete.sql
-- Soft-delete on `training_blocks` and `sessions`.
--
-- Adds a nullable `deleted_at timestamptz` to both tables. Backwards
-- compatible: every existing row stays NULL, every existing query that
-- DOESN'T filter on the new column behaves identically. Application
-- code is updated in lockstep to filter `WHERE deleted_at IS NULL` on
-- user-facing reads and to expose a Trash page that lists rows where
-- the column IS NOT NULL.
--
-- Why soft-delete and not a hard delete with a confirmation modal?
-- AGENTS.md DC-K4 ("override-and-warn, never silent overrule") — for
-- destructive actions that aren't a safety hard-block, the canonical
-- pattern is to make them reversible. An "Undo" affordance on a
-- bottom-of-viewport banner is the cheapest, lowest-friction safety
-- net we can offer without dropping a confirmation modal on every
-- delete press.
--
-- Cascade strategy (covered by the existing FKs in migration 0008 /
-- 0003 — no FK changes needed in this migration):
--   - planned_sessions.block_id REFERENCES training_blocks(id)
--       ON DELETE CASCADE  → hard-delete of a block cascades to its
--       planned_sessions automatically.
--   - set_logs.session_id REFERENCES sessions(id)
--       ON DELETE CASCADE  → hard-delete of a session cascades to its
--       set_logs and cardio_logs automatically.
--   - cardio_logs.session_id REFERENCES sessions(id) ON DELETE CASCADE.
--
-- Soft-delete is implicit for children: every user-facing query joins
-- through the parent (sessions for set_logs / cardio_logs, blocks for
-- planned_sessions), and the parent is filtered on
-- `deleted_at IS NULL` — so the children are hidden as a side-effect.
-- This keeps the schema simpler than putting `deleted_at` on every
-- child table.
--
-- RLS: the existing `*_update_self` and `*_delete_self` policies on
-- both tables already cover (a) the UPDATE that flips deleted_at to
-- NOW() (soft-delete), (b) the UPDATE that flips it back to NULL
-- (restore), and (c) the eventual hard DELETE from the Trash page or
-- the 30-day cleanup cron. No policy changes required.
--
-- The cleanup cron (apps/web/src/app/api/cron/trash-cleanup) uses the
-- service-role key (auth.uid() = NULL) and bypasses RLS — so the
-- DELETE will work even for rows whose user has since been removed.
--
-- IF NOT EXISTS keeps this re-runnable: the 0022-0024 dashboard-vs-
-- drizzle drift taught us not to assume the runner has perfect
-- tracking; this migration is similarly idempotent.

ALTER TABLE "training_blocks"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;

-- Partial indexes accelerate the two query shapes that matter:
--   - `WHERE deleted_at IS NULL`  → the default list filter (almost
--                                    every page touches this).
--   - `WHERE deleted_at IS NOT NULL` → the Trash page query and the
--                                       30-day cleanup cron.
-- Partial indexes are tiny in both cases because soft-deleted rows
-- are expected to be a small minority of the table.

CREATE INDEX IF NOT EXISTS "training_blocks_not_deleted_idx"
  ON "training_blocks" ("user_id", "started_on" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "training_blocks_deleted_idx"
  ON "training_blocks" ("user_id", "deleted_at")
  WHERE "deleted_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "sessions_not_deleted_idx"
  ON "sessions" ("user_id", "performed_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "sessions_deleted_idx"
  ON "sessions" ("user_id", "deleted_at")
  WHERE "deleted_at" IS NOT NULL;
