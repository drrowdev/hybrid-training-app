-- Manual rollback for 0168. Run in a maintenance window, after the app stops calling
-- training_schedule_read (the app falls back to the snapshot when it is missing).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.training_schedule_read();
COMMIT;
