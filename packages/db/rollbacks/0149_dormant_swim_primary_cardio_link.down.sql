-- ADR 0079. Roll back later activation first: preserve source history, resolve
-- bindings through its reviewed rollback, and restore the validated dormant CHECK.
-- Never detach or delete retained work here just to permit schema removal.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.planned_sessions, public.swim_workouts IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_workouts WHERE planned_session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing to roll back 0149: primary cardio bindings exist.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.swim_workouts'::regclass
      AND conname = 'swim_workouts_primary_cardio_link_dormant_check'
      AND contype = 'c' AND convalidated
      AND pg_catalog.pg_get_expr(conbin, conrelid) = '(planned_session_id IS NULL)'
  ) THEN
    RAISE EXCEPTION 'Refusing to roll back 0149: restore the dormant constraint first.';
  END IF;
END $$;

ALTER TABLE public.swim_workouts
  DROP CONSTRAINT swim_workouts_primary_cardio_link_dormant_check RESTRICT,
  DROP CONSTRAINT swim_workouts_owned_planned_session_fk RESTRICT,
  DROP CONSTRAINT swim_workouts_planned_session_id_unique RESTRICT,
  DROP COLUMN planned_session_id RESTRICT;
ALTER TABLE public.planned_sessions
  DROP CONSTRAINT planned_sessions_user_id_id_key RESTRICT;
COMMIT;
