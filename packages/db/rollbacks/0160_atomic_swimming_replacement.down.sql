-- Roll back the app first. Existing lifecycle history and replacement receipts stay intact.
BEGIN;
DROP FUNCTION public.replace_swim_plan_atomically(uuid,integer,jsonb,text,uuid,text,boolean);
COMMIT;
