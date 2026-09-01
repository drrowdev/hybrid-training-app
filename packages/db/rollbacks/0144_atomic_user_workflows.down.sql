-- Roll back the atomic workflow boundary only when doing so cannot re-enable
-- an already-created active-row conflict. Application code must be rolled back
-- before this file because it removes the RPCs it calls.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.training_blocks
    WHERE status = 'active' AND deleted_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM public.program_instances
    WHERE status = 'active' AND deleted_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM public.training_seasons
    WHERE status = 'active' AND deleted_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Refusing to roll back 0143_atomic_user_workflows: visible active rows are not unique.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.set_logs WHERE external_load_kg IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Refusing to roll back 0143_atomic_user_workflows: set_logs.external_load_kg contains recorded data.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_logs_reconcile_bw_progress_trg ON public.set_logs;
DROP TRIGGER IF EXISTS set_logs_reconcile_bw_progress_delete_trg ON public.set_logs;
DROP FUNCTION IF EXISTS public.reconcile_bw_progress_from_set_log();
DROP FUNCTION IF EXISTS public.reconcile_bw_progress_for_set_log(
  uuid, smallint, uuid, smallint, integer, numeric, numeric, boolean, integer, timestamptz, boolean, boolean
);
DROP FUNCTION IF EXISTS public.replace_bw_history_entry(jsonb, uuid, jsonb);
DROP TABLE IF EXISTS public.bw_set_progress_contributions;
DROP FUNCTION IF EXISTS public.replace_hyrox_session_actuals(
  uuid, jsonb, jsonb, integer, numeric, text
);
DROP FUNCTION IF EXISTS public.log_bodyweight_atomically(date, numeric, text, boolean);
DROP FUNCTION IF EXISTS public.atomic_user_workflows_ready();
DROP FUNCTION IF EXISTS public.update_program_instance_atomically(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
);
DROP FUNCTION IF EXISTS public.deploy_program_instance_atomically(
  jsonb, jsonb, jsonb, jsonb
);
DROP FUNCTION IF EXISTS public.create_training_season_atomically(text, jsonb, jsonb);

ALTER TABLE public.set_logs DROP COLUMN IF EXISTS external_load_kg;

DROP INDEX IF EXISTS public.training_blocks_one_visible_active_per_user;
DROP INDEX IF EXISTS public.program_instances_one_visible_active_per_user;
DROP INDEX IF EXISTS public.training_seasons_one_visible_active_per_user;

DROP FUNCTION IF EXISTS public.complete_training_session_with_transition(uuid, text);

NOTIFY pgrst, 'reload schema';
