-- 0025_block_lifecycle_timestamps.sql
-- Granular lifecycle timestamps on training_blocks.
--
-- The schema today carries `started_on` (date), `created_at` and
-- `updated_at` — but there's no canonical answer to "when did this
-- block end?". Both code paths that move a block out of 'active'
-- (manual `endBlock` → 'archived', auto `maybeCompleteBlock` →
-- 'completed') currently leave only `updated_at` as a proxy, which
-- collides with every other UPDATE on the row (notes edits, etc.).
--
-- Three nullable columns instead of one + a status-derived view:
--
--   ended_at      — single source of truth for "when did this end",
--                   set on either transition out of 'active'.
--   completed_at  — set ONLY when status transitions to 'completed'
--                   (auto-complete path: every planned session done).
--   archived_at   — set ONLY when status transitions to 'archived'
--                   (manual end via the End block button).
--
-- Stats want "blocks I completed in May" vs "blocks I gave up on"
-- without joining to a status filter — cheap to add three nullable
-- timestamptz columns now, future-proofs the audit story.
--
-- IF NOT EXISTS makes this safe to re-run (defense in depth — the
-- 0022–0024 dashboard-vs-drizzle drift taught us not to assume the
-- runner has perfect tracking).

ALTER TABLE "training_blocks"
  ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

-- Backfill: keep historical rows consistent with the new contract.
--
-- For pre-existing 'completed' rows, the only timestamp we have for
-- "when did this end" is updated_at. Copy it into both completed_at
-- and ended_at. Same idea for 'archived' rows. We only touch rows
-- where the new column is still NULL so the migration is idempotent.

UPDATE "training_blocks"
SET
  "completed_at" = COALESCE("completed_at", "updated_at"),
  "ended_at"     = COALESCE("ended_at", "updated_at")
WHERE "status" = 'completed'
  AND ("completed_at" IS NULL OR "ended_at" IS NULL);

UPDATE "training_blocks"
SET
  "archived_at" = COALESCE("archived_at", "updated_at"),
  "ended_at"    = COALESCE("ended_at", "updated_at")
WHERE "status" = 'archived'
  AND ("archived_at" IS NULL OR "ended_at" IS NULL);
