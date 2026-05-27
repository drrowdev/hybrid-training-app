-- 0068_planned_sessions_completed_or_skipped_check.sql
--
-- Mutual-exclusion guard between completed and skipped on planned_sessions.
--
-- Background (PR #174 code review): if the user opens the "Log now"
-- modal in one tab, then in another tab clicks "Mark skipped" and
-- confirms, then returns to the first tab and submits the modal — both
-- actions succeed and the row ends up with BOTH completed_session_id
-- and skipped_at set. Adherence treats the row as completed (the
-- if (row.completedSessionId) branch fires first), so skipped_at is
-- silently ignored, but the DB state is semantically inconsistent.
--
-- PR #173's conditional UPDATE (.is("completed_session_id", null)) only
-- protects against two concurrent startSession calls. It does NOT
-- protect against a skip that already ran before the link UPDATE.
--
-- Fix the invariant at the database level: it is impossible to set
-- both fields at once. Application code that races with itself now
-- gets a clean Postgres error instead of producing inconsistent state.
--
-- Backfill check: if any row already has both fields set in prod,
-- clear skipped_at (completed wins) before adding the constraint.
-- The check is conservative — a row with completed_session_id is by
-- definition "done", regardless of whether it was also flagged
-- skipped at some intermediate moment.

UPDATE public.planned_sessions
   SET skipped_at = NULL
 WHERE completed_session_id IS NOT NULL
   AND skipped_at IS NOT NULL;

ALTER TABLE public.planned_sessions
  ADD CONSTRAINT planned_sessions_completed_or_skipped_chk
  CHECK (completed_session_id IS NULL OR skipped_at IS NULL);
