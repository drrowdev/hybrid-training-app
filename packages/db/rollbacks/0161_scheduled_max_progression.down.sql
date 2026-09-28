BEGIN;
LOCK TABLE public.tm_suggestions,public.training_maxes IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.tm_suggestions WHERE source='scheduled_progression')
    OR EXISTS(SELECT 1 FROM public.training_maxes WHERE source='scheduled_progression') THEN
    RAISE EXCEPTION '0161 has been used; repair forward. No history or measurements will be removed.';
  END IF;
END $$;
DROP FUNCTION public.set_scheduled_max_progression(boolean);
DROP FUNCTION public.decide_max_suggestions(uuid[],boolean);
DROP FUNCTION public.generate_scheduled_max_progression(jsonb);
DROP FUNCTION public.account_max_is_programmed(uuid);
DROP INDEX public.tm_suggestions_scheduled_pending_idx;
ALTER TABLE public.tm_suggestions DROP CONSTRAINT tm_suggestions_source_chk;
ALTER TABLE public.tm_suggestions ADD CONSTRAINT tm_suggestions_source_chk
  CHECK (source IN ('derived_amrap','derived_rpe'));
ALTER TABLE public.training_maxes DROP CONSTRAINT training_maxes_source_chk;
ALTER TABLE public.training_maxes ADD CONSTRAINT training_maxes_source_chk
  CHECK (source IN ('entered','derived_amrap','derived_rpe'));
-- Retain the user's intake preference; older builds ignore the extra JSON key.
COMMIT;
