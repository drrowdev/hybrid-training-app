-- Correct already-upgraded environments: the database always owns set_index,
-- including replays from clients that may carry a legacy explicit value.

CREATE OR REPLACE FUNCTION public.assign_set_log_index()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.session_id::text, 0));

  SELECT COALESCE(MAX(sl.set_index) + 1, 0)::smallint
    INTO NEW.set_index
    FROM public.set_logs sl
   WHERE sl.session_id = NEW.session_id;

  RETURN NEW;
END;
$$;
