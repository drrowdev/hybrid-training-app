-- Manual rollback for 0169. Run in a maintenance window, after the app stops calling
-- retarget_completed_movement. Workouts already changed keep their new movement.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.retarget_completed_movement(uuid, uuid, uuid);
COMMIT;
