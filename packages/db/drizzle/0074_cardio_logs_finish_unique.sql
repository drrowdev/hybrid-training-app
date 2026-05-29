-- 0074_cardio_logs_finish_unique.sql
--
-- PR #208 (cardio in-session UX) follow-up — review-208 #1 caught an
-- idempotency gap in `logCardioSession`. The action computes
-- `block_index = count(*) where session_id = X` and inserts. A double-
-- tap on Finish workout or a network retry produces two rows with
-- block_indices 0 and 1, corrupting the session summary.
--
-- Fix: enforce uniqueness of (session_id, block_index) so retried
-- inserts collide. The action also switches to upsert with
-- onConflict='session_id,block_index' so the second attempt updates
-- the existing row instead of erroring.
--
-- Existing data: production has zero cardio_logs rows from this code
-- path so far (PR is unmerged). Safe to add NOT-NULL-aware uniqueness
-- without a deduplication backfill.

CREATE UNIQUE INDEX IF NOT EXISTS cardio_logs_session_block_unique
  ON public.cardio_logs (session_id, block_index);
