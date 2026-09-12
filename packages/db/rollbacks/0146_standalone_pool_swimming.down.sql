-- Roll back the application first. Never erase an issued plan or native result.
BEGIN;
LOCK TABLE public.swim_plans, public.swim_workouts, public.cardio_logs IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_plans)
     OR EXISTS (SELECT 1 FROM public.swim_workouts)
     OR EXISTS (SELECT 1 FROM public.cardio_logs WHERE swim_result IS NOT NULL) THEN
    RAISE EXCEPTION
      'Refusing to roll back 0145_standalone_pool_swimming: swimming history exists.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS cardio_logs_swim_guard ON public.cardio_logs;
DROP TRIGGER IF EXISTS sessions_swim_guard ON public.sessions;
DROP TRIGGER IF EXISTS sessions_swim_source_revision ON public.sessions;
DROP TRIGGER IF EXISTS sessions_swim_purge_revision ON public.sessions;
DROP TRIGGER IF EXISTS set_logs_swim_guard ON public.set_logs;
DROP TRIGGER IF EXISTS session_movements_swim_guard ON public.session_movements;
DROP TRIGGER IF EXISTS swim_workouts_purge_actuals ON public.swim_workouts;
DROP TRIGGER IF EXISTS limitations_swim_serialization ON public.limitations;
DROP FUNCTION IF EXISTS public.swim_create_plan(date, date, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_start_workout(uuid, integer);
DROP FUNCTION IF EXISTS public.swim_update_plan(uuid, integer, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_resume_plan(uuid, integer, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_set_plan_status(uuid, integer, text);
DROP FUNCTION IF EXISTS public.swim_skip_workout(uuid, integer, text);
DROP FUNCTION IF EXISTS public.swim_complete_workout(uuid, integer, jsonb, uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.swim_edit_result(uuid, integer, jsonb, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.swim_guard_cardio();
DROP FUNCTION IF EXISTS public.swim_guard_session();
DROP FUNCTION IF EXISTS public.swim_invalidate_session_source();
DROP FUNCTION IF EXISTS public.swim_guard_strength();
DROP FUNCTION IF EXISTS public.swim_forget_purged_actuals();
DROP FUNCTION IF EXISTS public.swim_assert_start_safety(jsonb);
DROP FUNCTION IF EXISTS public.swim_serialize_limitation_change();
DROP FUNCTION IF EXISTS public.swim_prescription_regions(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_result_course(jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public.swim_validate_workout_append(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_state_append(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_result_summary(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_result(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_plan(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_plan_binding(jsonb, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_workout(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_prescription(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_observation(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_verified_calibration(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_snapshot(jsonb);
DROP FUNCTION IF EXISTS public.swim_validate_labels(jsonb, text[], boolean);
DROP FUNCTION IF EXISTS public.swim_validate_course(jsonb);
DROP FUNCTION IF EXISTS public.swim_array_append_only(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.swim_bounded_integer(jsonb, bigint, bigint);
DROP FUNCTION IF EXISTS public.swim_storage_ready();
DROP FUNCTION IF EXISTS public.swim_local_today();
DROP TABLE public.swim_workouts;
DROP TABLE public.swim_plans;
DROP INDEX public.cardio_logs_one_swim_result_per_session;
ALTER TABLE public.cardio_logs DROP COLUMN swim_result;
DROP INDEX public.sessions_user_id_id_key;

REVOKE SELECT, INSERT, UPDATE ON public.sessions, public.cardio_logs FROM swim_writer;
REVOKE SELECT ON public.planned_sessions, public.set_logs, public.session_movements FROM swim_writer;
REVOKE SELECT (id, timezone) ON public.profiles FROM swim_writer;
REVOKE SELECT (user_id, region, affected_muscles, affected_movement_ids, allowed_movement_ids, resolved_at)
  ON public.limitations FROM swim_writer;
REVOKE SELECT (id, slug, user_id) ON public.movements FROM swim_writer;
REVOKE EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid, text, uuid) FROM swim_writer;
REVOKE EXECUTE ON FUNCTION auth.uid() FROM swim_writer;
REVOKE USAGE ON SCHEMA public, auth FROM swim_writer;
DROP ROLE swim_writer;
COMMIT;
