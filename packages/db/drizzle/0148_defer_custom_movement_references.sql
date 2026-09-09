-- ADR 0080. Drizzle executes this whole file in its migration transaction.
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $migration$
DECLARE
  matched boolean;
BEGIN
  LOCK TABLE public.set_logs, public.session_movements IN ACCESS EXCLUSIVE MODE;

  WITH targets AS (
    SELECT c.* FROM pg_catalog.pg_constraint c
    WHERE c.conname IN ('set_logs_movement_id_fkey', 'session_movements_movement_id_fkey')
      OR (c.contype = 'f'
        AND c.conrelid IN ('public.set_logs'::regclass, 'public.session_movements'::regclass)
        AND (c.confrelid = 'public.movements'::regclass OR
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = c.conrelid
            AND attname = 'movement_id' AND NOT attisdropped) = ANY(c.conkey)))
  )
  SELECT count(*) = 2 AND COALESCE(bool_and((
    ((c.conrelid = 'public.set_logs'::regclass AND c.conname = 'set_logs_movement_id_fkey')
      OR (c.conrelid = 'public.session_movements'::regclass AND c.conname = 'session_movements_movement_id_fkey'))
    AND c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.contypid = 0
    AND c.confrelid = 'public.movements'::regclass
    AND c.conkey = ARRAY[a.attnum] AND c.confkey = ARRAY[b.attnum]
    AND a.atttypid = 'uuid'::regtype AND b.atttypid = 'uuid'::regtype
    AND a.atttypmod = -1 AND b.atttypmod = -1 AND a.attnotnull AND b.attnotnull
    AND c.confdeltype = 'r' AND c.confupdtype = 'a' AND c.confmatchtype = 's'
    AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred
    AND c.conislocal AND c.coninhcount = 0 AND c.conparentid = 0 AND c.connoinherit
    AND c.conpfeqop = ARRAY['=(uuid,uuid)'::regoperator::oid]
    AND c.conppeqop = c.conpfeqop AND c.conffeqop = c.conpfeqop
    AND c.confdelsetcols IS NULL AND c.conexclop IS NULL AND c.conbin IS NULL
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid = c.conindid
      AND i.indrelid = c.confrelid AND i.indisprimary AND i.indisvalid AND i.indisunique
      AND i.indkey::smallint[] @> c.confkey AND i.indnkeyatts = 1)
    AND t.relowner = 'postgres'::regrole AND m.relowner = 'postgres'::regrole
    AND t.relkind = 'r' AND m.relkind = 'r' AND NOT t.relispartition AND NOT m.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits
      WHERE inhrelid IN (t.oid, m.oid) OR inhparent IN (t.oid, m.oid))
    AND pg_catalog.pg_get_constraintdef(c.oid, false) =
      'FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE RESTRICT'
  ) IS TRUE), false) INTO matched
  FROM targets c
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'movement_id' AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attribute b ON b.attrelid = c.confrelid AND b.attname = 'id' AND NOT b.attisdropped
  LEFT JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
  LEFT JOIN pg_catalog.pg_class m ON m.oid = c.confrelid;
  IF matched IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Movement reference definitions do not match original schema';
  END IF;

  ALTER TABLE public.set_logs DROP CONSTRAINT set_logs_movement_id_fkey;
  ALTER TABLE public.set_logs ADD CONSTRAINT set_logs_movement_id_fkey
    FOREIGN KEY (movement_id) REFERENCES public.movements(id) MATCH SIMPLE
    ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
  ALTER TABLE public.session_movements DROP CONSTRAINT session_movements_movement_id_fkey;
  ALTER TABLE public.session_movements ADD CONSTRAINT session_movements_movement_id_fkey
    FOREIGN KEY (movement_id) REFERENCES public.movements(id) MATCH SIMPLE
    ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
END;
$migration$;
