BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.swim_import_matches IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_import_matches) THEN
    RAISE EXCEPTION 'SWIM_MATCH_HISTORY_RETAINED';
  END IF;
END $$;
DROP VIEW public.swim_current_import_matches;
DROP FUNCTION public.swim_match_import(uuid,uuid,uuid,uuid,integer);
DROP FUNCTION public.swim_import_matching_ready();
DROP TABLE public.swim_import_matches;
ALTER TABLE public.swim_imports DROP CONSTRAINT swim_imports_owned_activity_id_key;
ALTER TABLE public.swim_workouts DROP CONSTRAINT swim_workouts_user_id_id_key;
REVOKE SELECT ON public.swim_imports FROM swim_writer;
COMMIT;
