BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.swim_conditioning_bindings, public.swim_conditioning_saves IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_conditioning_bindings)
     OR EXISTS (SELECT 1 FROM public.swim_conditioning_saves) THEN
    RAISE EXCEPTION 'Conditioning history exists; this rollback is not safe.';
  END IF;
END $$;
DROP TRIGGER swim_conditioning_primary_consistency ON public.planned_sessions;
DROP TRIGGER swim_conditioning_workout_consistency ON public.swim_workouts;
DROP TRIGGER swim_conditioning_block_consistency ON public.training_blocks;
DROP FUNCTION public.check_swim_conditioning_binding();
DROP VIEW public.swim_conditioning_sessions;
DROP FUNCTION public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION public.swim_conditioning_replay(uuid,jsonb);
DROP FUNCTION public.swim_conditioning_ready();
DROP FUNCTION public.swim_conditioning_benchmarks_ready();
DROP TABLE public.swim_conditioning_saves;
DROP TABLE public.swim_conditioning_bindings;
ALTER TABLE public.program_instances DROP CONSTRAINT conditioning_instances_owner_id_key;
ALTER TABLE public.planned_sessions DROP CONSTRAINT conditioning_sessions_owner_id_key;
ALTER TABLE public.training_blocks DROP CONSTRAINT conditioning_blocks_owner_id_key;
REVOKE EXECUTE ON FUNCTION public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb),
  public.swim_create_plan(date,date,jsonb,jsonb,jsonb), auth.uid() FROM conditioning_writer;
REVOKE ALL ON public.training_blocks, public.planned_sessions, public.program_instances,
  public.training_maxes, public.swim_plans, public.swim_workouts, public.swim_import_outcomes FROM conditioning_writer;
REVOKE SELECT (id, timezone) ON public.profiles FROM conditioning_writer;
REVOKE SELECT (id, user_id) ON public.movements FROM conditioning_writer;
REVOKE UPDATE (revision) ON public.swim_plans, public.swim_workouts FROM conditioning_writer;
REVOKE USAGE ON SCHEMA public, auth FROM conditioning_writer;
DROP ROLE conditioning_writer;
COMMIT;
