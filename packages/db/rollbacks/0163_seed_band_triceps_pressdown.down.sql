-- Manual, unused-only rollback. Run in a maintenance window: locks prevent
-- new UUID/slug references appearing between the check and catalog deletion.
-- Check all public tables, including JSON prescriptions and historical snapshots,
-- not just movement_id FKs (some references cascade or have no FK).
-- Refusal means repair forward; never remove history to make this down succeed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE
  movement uuid;
  entry record;
  referenced boolean;
BEGIN
  FOR entry IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', entry.relname);
  END LOOP;

  SELECT id INTO movement FROM public.movements
  WHERE user_id IS NULL AND slug = 'band-triceps-pressdown';
  IF movement IS NULL THEN RETURN; END IF;

  FOR entry IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname <> 'movement_instructions'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I t WHERE
        ($1 <> ''movements'' OR to_jsonb(t)->>''id'' IS DISTINCT FROM $2)
        AND (strpos(to_jsonb(t)::text, $2) > 0
          OR strpos(to_jsonb(t)::text, ''band-triceps-pressdown'') > 0))',
      entry.relname
    ) INTO referenced USING entry.relname, movement::text;
    IF referenced THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'Refusing 0163 rollback: band triceps pressdown is referenced. Repair forward.';
    END IF;
  END LOOP;

  DELETE FROM public.movement_instructions WHERE movement_id = movement;
  DELETE FROM public.movements WHERE id = movement AND user_id IS NULL;
END $$;
COMMIT;
