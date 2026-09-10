-- ADR 0079 / DC-SW5/SW7/SW8/SW9. Dormant foundation; no binding is permitted.
-- Drizzle executes this whole file atomically. No backfill or application activation.
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.planned_sessions
  ADD CONSTRAINT planned_sessions_user_id_id_key UNIQUE (user_id, id);

ALTER TABLE public.swim_workouts
  ADD COLUMN planned_session_id uuid,
  ADD CONSTRAINT swim_workouts_planned_session_id_unique UNIQUE (planned_session_id),
  ADD CONSTRAINT swim_workouts_owned_planned_session_fk
    FOREIGN KEY (user_id, planned_session_id)
    REFERENCES public.planned_sessions (user_id, id)
    ON DELETE SET NULL (planned_session_id),
  ADD CONSTRAINT swim_workouts_primary_cardio_link_dormant_check
    CHECK (planned_session_id IS NULL);