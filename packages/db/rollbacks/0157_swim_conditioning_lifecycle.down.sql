BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.swim_conditioning_bindings, public.swim_plans IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_conditioning_bindings)
    OR EXISTS (SELECT 1 FROM public.swim_plans WHERE state ? 'conditioningChanges') THEN
    RAISE EXCEPTION 'Conditioning history exists; this rollback is not safe.';
  END IF;
END $$;
DROP TRIGGER swim_conditioning_end_with_program ON public.training_blocks;
DROP FUNCTION public.swim_update_conditioning_program(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid);
DROP FUNCTION public.swim_lock_conditioning_program(uuid);
DROP FUNCTION public.swim_conditioning_program_edit_ready();
DROP FUNCTION public.swim_conditioning_end_with_program();
DROP TRIGGER swim_conditioning_state_guard ON public.swim_plans;
DROP FUNCTION public.swim_conditioning_state_guard();
DROP FUNCTION public.swim_change_conditioning(uuid,jsonb);
DROP FUNCTION public.swim_replay_conditioning_change(uuid,uuid,jsonb);
DROP FUNCTION public.swim_conditioning_check_safety(uuid,uuid);
DROP FUNCTION public.swim_conditioning_lifecycle_ready();
REVOKE UPDATE (status, state, updated_at) ON public.swim_plans FROM conditioning_writer;
REVOKE UPDATE (status, scheduled_date, definition, updated_at) ON public.swim_workouts FROM conditioning_writer;
COMMIT;
