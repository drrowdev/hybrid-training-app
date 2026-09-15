BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.swim_import_outcomes IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_import_outcomes) THEN
    RAISE EXCEPTION 'SWIM_OUTCOME_HISTORY_RETAINED';
  END IF;
END $$;
DROP VIEW public.swim_current_import_outcomes;
DROP FUNCTION public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer);
DROP FUNCTION public.swim_import_outcomes_ready();
DROP TABLE public.swim_import_outcomes;
ALTER TABLE public.swim_import_matches DROP CONSTRAINT swim_import_matches_owned_workout_id_key;
COMMIT;
