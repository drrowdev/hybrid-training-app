-- ADR0081: never erase connection or imported history to permit a down.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.swim_connections, public.swim_imports IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_connections) OR EXISTS (SELECT 1 FROM public.swim_imports) THEN
    RAISE EXCEPTION 'SWIM_IMPORT_HISTORY_PRESENT';
  END IF;
END $$;
DROP FUNCTION public.swim_import_receive(text,jsonb);
DROP FUNCTION public.swim_import_disconnect(uuid);
DROP FUNCTION public.swim_import_connect(text);
DROP FUNCTION public.swim_import_storage_ready();
DROP TABLE public.swim_imports;
DROP TABLE public.swim_connections;
DROP FUNCTION public.swim_import_evidence_valid(jsonb);
DROP FUNCTION public.swim_import_number(jsonb,numeric,boolean);
DROP FUNCTION public.swim_import_keys(jsonb,text[]);
COMMIT;
