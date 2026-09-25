-- Roll back the app first. Metadata is retained, not rewritten or discarded.
BEGIN;
DROP FUNCTION public.save_prescription_if_current(text,uuid,text,jsonb,boolean);
DROP TRIGGER prescription_revision ON public.planned_sessions;
DROP TRIGGER prescription_revision ON public.sessions;
DROP FUNCTION public.stamp_prescription_revision();
COMMIT;
