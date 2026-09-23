-- ADR 0087. Additive identities; no classification or rewriting of existing rows.
DO $$
DECLARE entry record; routine oid; body text; definition text; attributes jsonb; prefix text;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb)', '0538a9e3e6ec8ba5fa711f6d0436ba15',
      E'\n  -- ADR0087 refuse the old archive-all deployment entrypoint.\n  RAISE EXCEPTION ''Refresh program setup before saving.'' USING ERRCODE = ''55000'';'),
    ('public.update_program_instance_atomically(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'c3b72f4a3cac2ac588aef6bc109c4904',
      E'\n  -- ADR0087 typed programs never overwrite an account loading percentage.\n  IF EXISTS (SELECT 1 FROM public.training_blocks WHERE id = p_block_id AND user_id = auth.uid() AND program_kind IS NOT NULL)\n    AND COALESCE(p_tm_percents, ''[]''::jsonb) <> ''[]''::jsonb THEN\n    RAISE EXCEPTION ''Refresh program load settings before saving.'' USING ERRCODE = ''55000'';\n  END IF;')
  ) AS baseline(signature, fingerprint, guard) LOOP
    routine := to_regprocedure(entry.signature);
    SELECT prosrc, pg_get_functiondef(oid), jsonb_build_array(proowner, prosecdef, proconfig, proacl::text)
      INTO body, definition, attributes FROM pg_proc WHERE oid = routine;
    IF routine IS NULL OR md5(replace(body, E'\r\n', E'\n')) IS DISTINCT FROM entry.fingerprint
      OR (SELECT prosecdef FROM pg_proc WHERE oid = routine) THEN
      RAISE EXCEPTION 'Independent programs require the exact existing program RPC: %', entry.signature;
    END IF;
    prefix := entry.guard;
    EXECUTE replace(definition, body, regexp_replace(body, E'\\mBEGIN\\M', 'BEGIN' || prefix));
    IF (SELECT jsonb_build_array(proowner, prosecdef, proconfig, proacl::text) FROM pg_proc WHERE oid = routine)
      IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Program RPC permissions changed unexpectedly.'; END IF;
  END LOOP;
END $$;

ALTER TABLE public.training_blocks ADD COLUMN program_kind text;
ALTER TABLE public.training_blocks ADD CONSTRAINT training_blocks_program_kind_check
  CHECK (program_kind IS NULL OR program_kind IN ('strength','running','hybrid'));
ALTER TABLE public.training_blocks ADD CONSTRAINT training_blocks_user_id_id_key UNIQUE(user_id,id);
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.program_instances'::regclass
    AND conname='program_instances_block_id_fkey'
    AND pg_get_constraintdef(oid)='FOREIGN KEY (block_id) REFERENCES training_blocks(id) ON DELETE SET NULL')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.planned_sessions'::regclass
    AND conname='planned_sessions_block_id_fkey'
    AND pg_get_constraintdef(oid)='FOREIGN KEY (block_id) REFERENCES training_blocks(id) ON DELETE CASCADE') THEN
    RAISE EXCEPTION 'The existing program parent references changed unexpectedly.';
  END IF;
END $$;
ALTER TABLE public.program_instances DROP CONSTRAINT program_instances_block_id_fkey;
ALTER TABLE public.planned_sessions DROP CONSTRAINT planned_sessions_block_id_fkey;
ALTER TABLE public.program_instances ADD CONSTRAINT program_instances_block_id_fkey
  FOREIGN KEY(user_id,block_id) REFERENCES public.training_blocks(user_id,id) ON DELETE SET NULL (block_id);
ALTER TABLE public.planned_sessions ADD CONSTRAINT planned_sessions_block_id_fkey
  FOREIGN KEY(user_id,block_id) REFERENCES public.training_blocks(user_id,id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE c.oid=to_regclass('public.training_blocks_one_visible_active_per_user')
        AND i.indisunique AND i.indisvalid AND i.indnatts=1
        AND pg_get_indexdef(i.indexrelid,1,true)='user_id'
        AND regexp_replace(pg_get_expr(i.indpred,i.indrelid), '[()]', '', 'g')
          = 'status = ''active''::training_block_status AND deleted_at IS NULL')
    OR NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE c.oid=to_regclass('public.program_instances_one_visible_active_per_user')
        AND i.indisunique AND i.indisvalid AND i.indnatts=1
        AND pg_get_indexdef(i.indexrelid,1,true)='user_id'
        AND regexp_replace(pg_get_expr(i.indpred,i.indrelid), '[()]', '', 'g')
          = 'status = ''active''::text AND deleted_at IS NULL') THEN
    RAISE EXCEPTION 'Independent programs require the exact existing active-program indexes.';
  END IF;
END $$;
DROP INDEX public.training_blocks_one_visible_active_per_user;
DROP INDEX public.program_instances_one_visible_active_per_user;
CREATE UNIQUE INDEX training_blocks_one_active_per_kind ON public.training_blocks(user_id,program_kind)
  WHERE status='active' AND deleted_at IS NULL AND program_kind IS NOT NULL;
CREATE UNIQUE INDEX training_blocks_one_active_legacy ON public.training_blocks(user_id)
  WHERE status='active' AND deleted_at IS NULL AND program_kind IS NULL;
CREATE UNIQUE INDEX program_instances_one_active_per_block ON public.program_instances(user_id,block_id)
  WHERE status='active' AND deleted_at IS NULL AND block_id IS NOT NULL;
CREATE UNIQUE INDEX program_instances_one_active_orphan ON public.program_instances(user_id)
  WHERE status='active' AND deleted_at IS NULL AND block_id IS NULL;

CREATE FUNCTION public.guard_program_block_identity()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.program_kind IS NULL THEN
    RAISE EXCEPTION 'Choose a program type in the current program setup.' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.program_kind IS DISTINCT FROM OLD.program_kind OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'A program keeps its original type and owner.' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND OLD.program_kind IS NOT NULL AND
    (NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.program_family IS DISTINCT FROM OLD.program_family) THEN
    RAISE EXCEPTION 'Replace the program to use a different template.' USING ERRCODE='22023';
  END IF;
  IF NEW.program_kind IS NOT NULL AND (NEW.program_id IS NULL OR NEW.program_family IS NULL) THEN
    RAISE EXCEPTION 'A typed program requires its engine identity.' USING ERRCODE='22023';
  END IF;
  IF NEW.status='active' AND NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.training_blocks b WHERE b.user_id=NEW.user_id AND b.id<>NEW.id
      AND b.status='active' AND b.deleted_at IS NULL
      AND (b.program_kind IS NULL OR NEW.program_kind IS NULL)
  ) THEN
    RAISE EXCEPTION 'End the older program before starting independent programs.' USING ERRCODE='23514';
  END IF;
  IF NEW.program_kind IS NOT NULL AND NEW.status='active' AND NEW.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.program_instances i WHERE i.user_id=NEW.user_id
      AND i.status='active' AND i.deleted_at IS NULL AND i.block_id IS NULL
  ) THEN
    RAISE EXCEPTION 'An older program has no linked plan. Resolve it before starting independent programs.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    INSERT INTO public.engine_override_events(user_id,event_type,context) VALUES(NEW.user_id,'custom',
      jsonb_build_object('kind','independent-program-created-v1','programOwnershipVersion',1,'blockId',NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_blocks_program_identity BEFORE INSERT OR UPDATE ON public.training_blocks
FOR EACH ROW EXECUTE FUNCTION public.guard_program_block_identity();
REVOKE ALL ON FUNCTION public.guard_program_block_identity() FROM PUBLIC,anon;

CREATE FUNCTION public.guard_program_instance_identity()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE parent public.training_blocks%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'A program keeps its original owner.' USING ERRCODE='23514';
  END IF;
  IF NEW.block_id IS NULL THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'A new program requires its owned plan.' USING ERRCODE='23514'; END IF;
    IF OLD.block_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.training_blocks WHERE id=OLD.block_id) THEN
        RAISE EXCEPTION 'A program cannot be detached from its plan.' USING ERRCODE='23514';
      END IF;
      NEW.status := 'archived';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO parent FROM public.training_blocks WHERE id=NEW.block_id AND user_id=NEW.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program plan not found.' USING ERRCODE='23503'; END IF;
  IF TG_OP='INSERT' AND parent.program_kind IS NULL THEN
    RAISE EXCEPTION 'New programs require a typed plan.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.block_id IS DISTINCT FROM OLD.block_id THEN
    RAISE EXCEPTION 'A program cannot be moved to another plan.' USING ERRCODE='23514';
  END IF;
  IF parent.program_kind IS NOT NULL THEN
    IF NEW.program_id IS DISTINCT FROM parent.program_id OR NEW.program_family IS DISTINCT FROM parent.program_family
      OR (NEW.program_id='authored' AND NEW.instance->>'activity' IS DISTINCT FROM parent.program_kind) THEN
      RAISE EXCEPTION 'Program type and engine must match its plan.' USING ERRCODE='23514';
    END IF;
    IF (NEW.status='active' AND NEW.deleted_at IS NULL) IS DISTINCT FROM
       (parent.status='active' AND parent.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Program lifecycle must match its plan.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER program_instances_program_identity BEFORE INSERT OR UPDATE ON public.program_instances
FOR EACH ROW EXECUTE FUNCTION public.guard_program_instance_identity();
REVOKE ALL ON FUNCTION public.guard_program_instance_identity() FROM PUBLIC,anon;

CREATE FUNCTION public.sync_program_instance_lifecycle()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.program_kind IS NOT NULL AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    UPDATE public.program_instances SET
      status=CASE WHEN NEW.status='active' AND NEW.deleted_at IS NULL THEN 'active' ELSE 'archived' END,
      deleted_at=NEW.deleted_at, updated_at=now()
      WHERE user_id=NEW.user_id AND block_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER training_blocks_instance_lifecycle AFTER UPDATE ON public.training_blocks
FOR EACH ROW EXECUTE FUNCTION public.sync_program_instance_lifecycle();
REVOKE ALL ON FUNCTION public.sync_program_instance_lifecycle() FROM PUBLIC,anon;

CREATE FUNCTION public.check_program_parent_consistency()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE block_id uuid; parent public.training_blocks%ROWTYPE; instance_count integer;
BEGIN
  IF TG_TABLE_NAME='training_blocks' THEN block_id:=COALESCE(NEW.id,OLD.id);
  ELSE block_id:=COALESCE(NEW.block_id,OLD.block_id); END IF;
  SELECT * INTO parent FROM public.training_blocks WHERE id=block_id;
  IF NOT FOUND OR parent.program_kind IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO instance_count FROM public.program_instances i WHERE i.block_id=parent.id AND i.user_id=parent.user_id
    AND i.status='active' AND i.deleted_at IS NULL;
  IF (parent.status='active' AND parent.deleted_at IS NULL AND instance_count<>1)
    OR ((parent.status<>'active' OR parent.deleted_at IS NOT NULL) AND instance_count<>0) THEN
    RAISE EXCEPTION 'A typed program needs exactly one matching active instance.' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER training_blocks_parent_consistency AFTER INSERT OR UPDATE ON public.training_blocks
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_program_parent_consistency();
CREATE CONSTRAINT TRIGGER program_instances_parent_consistency AFTER INSERT OR UPDATE OR DELETE ON public.program_instances
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_program_parent_consistency();
REVOKE ALL ON FUNCTION public.check_program_parent_consistency() FROM PUBLIC,anon;

ALTER TABLE public.rehab_protocols ADD CONSTRAINT rehab_protocols_user_id_id_key UNIQUE(user_id,id);
CREATE TABLE public.swim_plan_rehab_bindings (
  plan_id uuid NOT NULL,
  local_protocol_id text NOT NULL CHECK(local_protocol_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  rehab_protocol_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id,local_protocol_id),
  UNIQUE(plan_id,rehab_protocol_id),
  CONSTRAINT swim_plan_rehab_bindings_owned_plan_fk FOREIGN KEY(user_id,plan_id)
    REFERENCES public.swim_plans(user_id,id) ON DELETE CASCADE,
  CONSTRAINT swim_plan_rehab_bindings_owned_protocol_fk FOREIGN KEY(user_id,rehab_protocol_id)
    REFERENCES public.rehab_protocols(user_id,id) ON DELETE RESTRICT
);
CREATE INDEX swim_plan_rehab_bindings_owner_idx ON public.swim_plan_rehab_bindings(user_id);
CREATE INDEX swim_plan_rehab_bindings_protocol_idx ON public.swim_plan_rehab_bindings(rehab_protocol_id);
ALTER TABLE public.swim_plan_rehab_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_plan_rehab_bindings_owner ON public.swim_plan_rehab_bindings
  USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
REVOKE ALL ON public.swim_plan_rehab_bindings FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.swim_plan_rehab_bindings TO authenticated;
CREATE TRIGGER swim_plan_rehab_bindings_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.swim_plan_rehab_bindings
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER rehab_protocols_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.rehab_protocols
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();
CREATE TRIGGER program_rehab_bindings_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.program_rehab_bindings
FOR EACH STATEMENT EXECUTE FUNCTION public.training_schedule_lock();

CREATE FUNCTION public.validate_owned_rehab_items(p_items jsonb,p_protocol_id uuid,p_revision integer)
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE protocol public.rehab_protocols%ROWTYPE; item jsonb; original jsonb; item_index integer; set_index integer;
  expected integer; actual integer;
BEGIN
  SELECT * INTO protocol FROM public.rehab_protocols WHERE id=p_protocol_id AND user_id=auth.uid();
  IF NOT FOUND OR protocol.revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'The rehab protocol changed. Review it again.' USING ERRCODE='40001';
  END IF;
  SELECT sum((value->>'sets')::integer) INTO expected FROM jsonb_array_elements(protocol.definition->'items');
  SELECT count(*) INTO actual FROM jsonb_array_elements(p_items);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Rehab must retain every prescribed set.' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    item_index:=(item#>>'{meta,rehabItemIndex}')::integer;
    set_index:=(item#>>'{meta,rehabSetIndex}')::integer;
    original:=protocol.definition->'items'->item_index;
    IF original IS NULL OR item_index IS NULL OR set_index IS NULL OR item_index<0 OR set_index<0
      OR set_index>=(original->>'sets')::integer
      OR item->>'kind' IS DISTINCT FROM 'tendon' OR item->>'sets' IS DISTINCT FROM '1'
      OR item#>>'{meta,rehab}' IS DISTINCT FROM 'true'
      OR item#>>'{meta,rehabProtocolId}' IS DISTINCT FROM p_protocol_id::text
      OR item#>>'{meta,rehabProtocolRevision}' IS DISTINCT FROM p_revision::text
      OR item->'movementId' IS DISTINCT FROM original->'movementId'
      OR item->'reps' IS DISTINCT FROM original->'reps'
      OR item->'repRange' IS DISTINCT FROM original->'repRange'
      OR item->'targetWeightKg' IS DISTINCT FROM original->'targetWeightKg'
      OR item#>'{meta,side}' IS DISTINCT FROM original->'side'
      OR item->'holdSec' IS DISTINCT FROM (CASE WHEN original ? 'holdSeconds'
        THEN jsonb_build_object('min',original->'holdSeconds','max',original->'holdSeconds') ELSE NULL END)
      OR item ?| ARRAY['percentTm','targetRpe','durationMin','distanceM','bw']
      OR COALESCE((item->>'isAmrap')::boolean,false) THEN
      RAISE EXCEPTION 'Rehab must retain its library exercise and dose.' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i
    GROUP BY i#>>'{meta,rehabItemIndex}',i#>>'{meta,rehabSetIndex}' HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'Rehab set identities must be unique.' USING ERRCODE='22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_owned_rehab_items(jsonb,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_owned_rehab_items(jsonb,uuid,integer) TO authenticated;

CREATE FUNCTION public.guard_program_prescription()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE parent public.training_blocks%ROWTYPE; item jsonb; protocol_id uuid; protocol_items jsonb; revision integer; part_id text; basis jsonb;
BEGIN
  SELECT * INTO parent FROM public.training_blocks WHERE id=NEW.block_id AND user_id=NEW.user_id;
  IF NOT FOUND OR parent.program_kind IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.block_id IS DISTINCT FROM OLD.block_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'A workout keeps its original program and owner.' USING ERRCODE='22023';
    END IF;
    IF NEW.prescription->'items' IS NOT DISTINCT FROM OLD.prescription->'items' THEN RETURN NEW; END IF;
    IF EXISTS(SELECT 1 FROM public.sessions WHERE id=OLD.completed_session_id AND user_id=OLD.user_id AND completed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Completed workouts keep their issued prescription.' USING ERRCODE='22023';
    END IF;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.prescription->'items') LOOP
    IF item ? 'percentTm' THEN
      basis:=item#>'{meta,programLoadBasis}';
      IF basis->>'version' IS DISTINCT FROM '1' OR NOT COALESCE(
        (basis->>'kind'='working-max' AND jsonb_typeof(basis->'kg')='number' AND (basis->>'kg')::numeric>0)
        OR (basis->>'kind'='one-rm' AND jsonb_typeof(basis->'percent')='number' AND (basis->>'percent')::numeric>0
          AND (basis->'roundingKg'='null'::jsonb OR
            (jsonb_typeof(basis->'roundingKg')='number' AND (basis->>'roundingKg')::numeric>0))),false) THEN
        RAISE EXCEPTION 'Programmed loads need this program''s load settings.' USING ERRCODE='22023';
      END IF;
    END IF;
    IF parent.program_kind='strength' AND item->>'kind' LIKE 'cardio_%' THEN
      RAISE EXCEPTION 'Choose Hybrid to include cardio.' USING ERRCODE='22023';
    END IF;
    IF parent.program_kind='running' THEN
      IF item->>'kind' LIKE 'cardio_%' THEN
        IF NOT EXISTS(SELECT 1 FROM public.movements m WHERE m.id=(item->>'movementId')::uuid
          AND (m.user_id IS NULL OR m.user_id=NEW.user_id) AND m.pattern='cardio'
          AND m.metadata->>'modality' IN ('run','running')) THEN
          RAISE EXCEPTION 'Choose Running exercises for a Running program.' USING ERRCODE='22023';
        END IF;
      ELSIF item->>'kind' IS DISTINCT FROM 'tendon' OR item#>>'{meta,rehabProtocolId}' IS NULL THEN
        RAISE EXCEPTION 'Running allows runs and attached rehab protocols.' USING ERRCODE='22023';
      END IF;
    END IF;
  END LOOP;
  IF parent.program_id='authored' OR parent.program_kind='running' THEN
    FOR part_id,protocol_id,revision IN SELECT DISTINCT i#>>'{meta,authoredPartId}',
        (i#>>'{meta,rehabProtocolId}')::uuid,(i#>>'{meta,rehabProtocolRevision}')::integer
      FROM jsonb_array_elements(NEW.prescription->'items') i WHERE i#>>'{meta,rehabProtocolId}' IS NOT NULL LOOP
      IF part_id IS NULL THEN RAISE EXCEPTION 'Attach rehab as a complete protocol.' USING ERRCODE='22023'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.program_rehab_bindings b JOIN public.program_instances pi
        ON pi.id=b.program_instance_id AND pi.user_id=b.user_id WHERE pi.block_id=parent.id AND b.user_id=NEW.user_id
          AND b.rehab_protocol_id=protocol_id AND b.local_protocol_id=protocol_id::text) THEN
        RAISE EXCEPTION 'Attach the owned rehab protocol before using it.' USING ERRCODE='23503';
      END IF;
      SELECT jsonb_agg(i) INTO protocol_items FROM jsonb_array_elements(NEW.prescription->'items') i
        WHERE i#>>'{meta,authoredPartId}'=part_id AND i#>>'{meta,rehabProtocolId}'=protocol_id::text;
      PERFORM public.validate_owned_rehab_items(protocol_items,protocol_id,revision);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planned_sessions_program_prescription BEFORE INSERT OR UPDATE ON public.planned_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_program_prescription();
REVOKE ALL ON FUNCTION public.guard_program_prescription() FROM PUBLIC,anon;

DO $$
DECLARE routine oid:=to_regprocedure('public.training_schedule_snapshot()'); body text; definition text; attributes jsonb;
  old_text text:=$old$    'timezone', zone$old$;
  new_text text:=$new$    'rehabBindings', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.plan_id,r.local_protocol_id)
      FROM public.swim_plan_rehab_bindings r WHERE r.user_id=u), '[]'::jsonb),
    'programRehabBindings', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.program_instance_id,r.local_protocol_id)
      FROM public.program_rehab_bindings r WHERE r.user_id=u), '[]'::jsonb),
    'rehabLibrary', COALESCE((SELECT jsonb_agg(jsonb_build_array(r.id,r.revision) ORDER BY r.id)
      FROM public.rehab_protocols r WHERE r.user_id=u), '[]'::jsonb),
    'timezone', zone$new$;
BEGIN
  SELECT prosrc,pg_get_functiondef(oid),jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
    INTO body,definition,attributes FROM pg_proc WHERE oid=routine;
  IF routine IS NULL OR md5(replace(body,E'\r\n',E'\n')) IS DISTINCT FROM '136f490e9b17d543848669a25eb03fa9'
    OR position(old_text IN body)=0 THEN RAISE EXCEPTION 'The shared schedule snapshot changed unexpectedly.'; END IF;
  EXECUTE replace(definition,body,replace(body,old_text,new_text));
  IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
    IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Schedule snapshot permissions changed unexpectedly.'; END IF;
END $$;

CREATE FUNCTION public.independent_programs_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$ SELECT true $$;
REVOKE ALL ON FUNCTION public.independent_programs_ready() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.independent_programs_ready() TO authenticated;

CREATE FUNCTION public.independent_program_schedule_commit(
  p_operation text,p_args jsonb,p_expected_revision text,p_request_id uuid,p_input_hash text,p_accept_overlap boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
  u uuid:=auth.uid(); before_snapshot jsonb; after_snapshot jsonb; receipt jsonb; result jsonb;
  replacement uuid; block_id uuid; instance_id uuid; kind text; target public.training_blocks%ROWTYPE;
  entry jsonb; overlap_pairs jsonb; block_args jsonb; instance_args jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'A valid save request is required.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  SELECT context INTO receipt FROM public.engine_override_events WHERE id=p_request_id AND user_id=u;
  IF FOUND THEN
    IF receipt->>'operation' IS DISTINCT FROM p_operation OR receipt->>'inputHash' IS DISTINCT FROM p_input_hash
      OR receipt->>'kind' IS DISTINCT FROM 'training-schedule-v1' THEN
      RAISE EXCEPTION 'This save request was already used for a different change.' USING ERRCODE='22023';
    END IF;
    IF receipt ? 'programOwnershipVersion' AND p_operation='primary-create' AND
      (receipt->>'replacedBlockId' IS DISTINCT FROM p_args->>'p_replace_block_id'
       OR receipt->>'programKind' IS DISTINCT FROM p_args#>>'{p_block,program_kind}') THEN
      RAISE EXCEPTION 'This save request belongs to a different program target.' USING ERRCODE='22023';
    END IF;
    RETURN receipt->'result';
  END IF;
  before_snapshot:=public.training_schedule_snapshot();
  IF p_expected_revision IS DISTINCT FROM before_snapshot->>'revision' THEN
    RAISE EXCEPTION 'Your schedule changed. Review the dates again.' USING ERRCODE='40001';
  END IF;
  IF p_operation<>'primary-create' THEN
    IF p_operation IN ('primary-update','authored-workout') THEN
      block_id:=COALESCE((p_args->>'p_block_id')::uuid,(p_args->>'blockId')::uuid);
      SELECT * INTO target FROM public.training_blocks WHERE id=block_id AND user_id=u;
      IF NOT FOUND OR target.status<>'active' OR target.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'This program is no longer active.';
      END IF;
      IF target.program_kind IS NOT NULL AND p_args->>'programKind' IS DISTINCT FROM target.program_kind THEN
        RAISE EXCEPTION 'Keep the original program type when editing.' USING ERRCODE='22023';
      END IF;
      SELECT id INTO instance_id FROM public.program_instances WHERE user_id=u AND program_instances.block_id=target.id
        AND status='active' AND deleted_at IS NULL;
      IF p_args ? 'p_rehab_bindings' THEN
        IF p_operation='primary-update' THEN
          DELETE FROM public.program_rehab_bindings WHERE program_instance_id=instance_id AND user_id=u;
        END IF;
        INSERT INTO public.program_rehab_bindings(program_instance_id,local_protocol_id,rehab_protocol_id,user_id)
          SELECT instance_id,b->>'localProtocolId',(b->>'rehabProtocolId')::uuid,u
            FROM jsonb_array_elements(p_args->'p_rehab_bindings') b
          ON CONFLICT(program_instance_id,local_protocol_id) DO UPDATE SET rehab_protocol_id=EXCLUDED.rehab_protocol_id;
      END IF;
    END IF;
    result:=public.training_schedule_commit(p_operation,p_args,public.training_schedule_snapshot()->>'revision',p_request_id,p_input_hash,p_accept_overlap);
    UPDATE public.engine_override_events SET context=context||jsonb_build_object('programOwnershipVersion',1,'revision',p_expected_revision)
      WHERE id=p_request_id AND user_id=u;
    RETURN result;
  END IF;
  block_args:=p_args->'p_block'; instance_args:=p_args->'p_program_instance';
  kind:=block_args->>'program_kind'; replacement:=(p_args->>'p_replace_block_id')::uuid;
  IF kind IS NULL OR kind NOT IN ('strength','running','hybrid') THEN
    RAISE EXCEPTION 'Choose Strength, Running or Hybrid.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM public.training_blocks WHERE user_id=u AND status='active' AND deleted_at IS NULL AND program_kind IS NULL) THEN
    RAISE EXCEPTION 'End the older program before starting independent programs.' USING ERRCODE='23514';
  END IF;
  IF replacement IS NOT NULL THEN
    SELECT * INTO target FROM public.training_blocks WHERE id=replacement AND user_id=u AND status='active' AND deleted_at IS NULL;
    IF NOT FOUND OR target.program_kind IS DISTINCT FROM kind THEN
      RAISE EXCEPTION 'Only the identified program of the same type can be replaced.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.training_blocks WHERE user_id=u AND program_kind=kind
    AND status='active' AND deleted_at IS NULL AND id IS DISTINCT FROM replacement) THEN
    RAISE EXCEPTION 'Review and confirm which program to replace.' USING ERRCODE='23505';
  END IF;
  IF jsonb_typeof(p_args->'p_planned_sessions') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_args->'p_planned_sessions')=0 THEN RAISE EXCEPTION 'Add a workout before saving.'; END IF;
  IF COALESCE(p_args->'p_tm_percents','[]'::jsonb)<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Program load settings must belong to this program.' USING ERRCODE='22023';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(p_args->'p_training_max_drafts','[]'::jsonb)) LOOP
    IF (entry->>'oneRmKg')::numeric IS NULL OR (entry->>'oneRmKg')::numeric<=0 OR (entry->>'oneRmKg')::numeric>1000
      OR NOT EXISTS(SELECT 1 FROM public.movements WHERE id=(entry->>'movementId')::uuid AND (user_id IS NULL OR user_id=u)) THEN
      RAISE EXCEPTION 'Choose an available exercise and a valid training max.';
    END IF;
    INSERT INTO public.training_maxes(user_id,movement_id,one_rm_kg,source)
      VALUES(u,(entry->>'movementId')::uuid,(entry->>'oneRmKg')::numeric,'entered')
      ON CONFLICT(user_id,movement_id) DO UPDATE SET one_rm_kg=EXCLUDED.one_rm_kg,source='entered',
        derived_from_session_id=NULL,derived_from_set_log_id=NULL,derived_formula=NULL,derived_at=NULL;
  END LOOP;
  IF replacement IS NOT NULL THEN
    UPDATE public.training_blocks SET status='archived',archived_at=COALESCE(archived_at,now()),
      ended_at=COALESCE(ended_at,now()),updated_at=now() WHERE id=replacement AND user_id=u;
  END IF;
  INSERT INTO public.training_blocks(user_id,program_kind,program_id,program_family,started_on,weeks,status,
    days_per_week,day_index_overrides,cardio_source,allows_two_a_days,accessory_volume,notes)
  SELECT u,kind,b.program_id,b.program_family,b.started_on,b.weeks,'active',
    b.days_per_week,b.day_index_overrides,b.cardio_source,b.allows_two_a_days,b.accessory_volume,b.notes
    FROM jsonb_to_record(block_args) b(program_id text,program_family text,started_on date,weeks smallint,
      days_per_week smallint,day_index_overrides jsonb,cardio_source text,allows_two_a_days boolean,accessory_volume text,notes text)
    RETURNING id INTO block_id;
  INSERT INTO public.program_instances(user_id,program_id,program_family,display_name,customization_version,instance,setup_input,block_id,status)
    SELECT u,i.program_id,i.program_family,i.display_name,i.customization_version,i.instance,i.setup_input,block_id,'active'
      FROM jsonb_to_record(instance_args) i(program_id text,program_family text,display_name text,customization_version smallint,instance jsonb,setup_input jsonb)
      RETURNING id INTO instance_id;
  INSERT INTO public.program_rehab_bindings(program_instance_id,local_protocol_id,rehab_protocol_id,user_id)
    SELECT instance_id,b->>'localProtocolId',(b->>'rehabProtocolId')::uuid,u
      FROM jsonb_array_elements(COALESCE(p_args->'p_rehab_bindings','[]'::jsonb)) b;
  INSERT INTO public.planned_sessions(block_id,user_id,week_index,day_index,slot,title,role,prescription,session_modality,effective_stress_load)
    SELECT block_id,u,p.week_index,p.day_index,p.slot,p.title,p.role,p.prescription,p.session_modality,p.effective_stress_load
      FROM jsonb_to_recordset(p_args->'p_planned_sessions') p(week_index smallint,day_index smallint,slot public.session_slot,
        title text,role text,prescription jsonb,session_modality text,effective_stress_load numeric);
  IF p_args->>'p_accept_recovery'='true' AND replacement IS NOT NULL THEN
    UPDATE public.program_recommendations SET status='accepted',resolved_at=now()
      WHERE program_recommendations.user_id=u AND program_recommendations.block_id=replacement
        AND program_recommendations.kind='deload' AND program_recommendations.status='pending';
  END IF;
  after_snapshot:=public.training_schedule_snapshot();
  WITH before_pairs AS (
    SELECT a->>'date' AS date,a->>'occupancyKey' AS a,b->>'occupancyKey' AS b
      FROM jsonb_array_elements(before_snapshot->'entries') a CROSS JOIN jsonb_array_elements(before_snapshot->'entries') b
      WHERE a->>'date'=b->>'date' AND a->>'state' NOT IN ('rest','paused') AND b->>'state' NOT IN ('rest','paused')
        AND a->>'occupancyKey'<b->>'occupancyKey'
  ), after_pairs AS (
    SELECT DISTINCT a->>'date' AS date,a->>'occupancyKey' AS a,b->>'occupancyKey' AS b
      FROM jsonb_array_elements(after_snapshot->'entries') a CROSS JOIN jsonb_array_elements(after_snapshot->'entries') b
      WHERE a->>'date'=b->>'date' AND a->>'state' NOT IN ('rest','paused') AND b->>'state' NOT IN ('rest','paused')
        AND a->>'occupancyKey'<b->>'occupancyKey'
  ) SELECT COALESCE(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO overlap_pairs FROM
    (SELECT * FROM after_pairs EXCEPT SELECT * FROM before_pairs) p;
  IF jsonb_array_length(overlap_pairs)>0 AND p_accept_overlap IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Review and accept the overlapping workouts before saving.' USING ERRCODE='22023';
  END IF;
  result:=jsonb_build_object('block_id',block_id,'program_instance_id',instance_id,'skipped',COALESCE((p_args->>'p_skipped')::integer,0));
  INSERT INTO public.engine_override_events(id,user_id,event_type,context) VALUES(p_request_id,u,'custom',
    jsonb_build_object('kind','training-schedule-v1','programOwnershipVersion',1,'programKind',kind,
      'replacedBlockId',replacement,'operation',p_operation,'inputHash',p_input_hash,'revision',p_expected_revision,
      'acceptedOverlap',p_accept_overlap,'overlaps',overlap_pairs,'result',result));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.complete_program_if_settled(p_block_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  IF NOT EXISTS(SELECT 1 FROM public.planned_sessions WHERE block_id=p_block_id AND user_id=u) OR EXISTS(
    SELECT 1 FROM public.planned_sessions p LEFT JOIN public.sessions s ON s.id=p.completed_session_id AND s.user_id=u
      WHERE p.block_id=p_block_id AND p.user_id=u AND p.skipped_at IS NULL AND p.role<>'rest'
        AND (s.id IS NULL OR s.completed_at IS NULL OR s.deleted_at IS NOT NULL)
  ) THEN RETURN false; END IF;
  UPDATE public.training_blocks SET status='completed',completed_at=now(),ended_at=now(),updated_at=now()
    WHERE id=p_block_id AND user_id=u AND status='active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.program_instances SET status='archived',updated_at=now() WHERE block_id=p_block_id AND user_id=u;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_program_if_settled(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_program_if_settled(uuid) TO authenticated;

CREATE FUNCTION public.commit_program_progression(
  p_block_id uuid,p_instance_id uuid,p_session_id uuid,p_expected_instance jsonb,p_next_instance jsonb,p_recommendations jsonb
)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); current_instance public.program_instances%ROWTYPE; receipt_id uuid; receipt jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  receipt_id:=md5('program-progression:'||u::text||':'||p_instance_id::text||':'||p_session_id::text)::uuid;
  SELECT context INTO receipt FROM public.engine_override_events WHERE id=receipt_id AND user_id=u;
  IF FOUND THEN
    IF receipt->>'kind' IS DISTINCT FROM 'program-progression-v1' OR receipt->>'blockId' IS DISTINCT FROM p_block_id::text THEN
      RAISE EXCEPTION 'Progression receipt does not match this program.' USING ERRCODE='22023';
    END IF;
    RETURN 'replayed';
  END IF;
  SELECT i.* INTO current_instance FROM public.program_instances i JOIN public.training_blocks b ON b.id=i.block_id AND b.user_id=i.user_id
    WHERE i.id=p_instance_id AND i.block_id=p_block_id AND i.user_id=u
      AND i.status='active' AND i.deleted_at IS NULL AND b.status='active' AND b.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'inactive'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.planned_sessions p JOIN public.sessions s ON s.id=p.completed_session_id AND s.user_id=p.user_id
    WHERE p.user_id=u AND p.block_id=p_block_id AND s.id=p_session_id AND s.completed_at IS NOT NULL AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Only a completed workout can advance its own program.' USING ERRCODE='22023';
  END IF;
  IF current_instance.instance IS DISTINCT FROM p_expected_instance THEN RETURN 'stale'; END IF;
  IF jsonb_typeof(p_next_instance) IS DISTINCT FROM 'object' OR jsonb_typeof(p_recommendations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid program progression.' USING ERRCODE='22023';
  END IF;
  UPDATE public.program_instances SET instance=p_next_instance,updated_at=now() WHERE id=p_instance_id AND user_id=u;
  INSERT INTO public.program_recommendations(user_id,program_instance_id,block_id,session_id,kind,occurrence_key,title,detail,data,status)
    SELECT u,p_instance_id,p_block_id,p_session_id,r.kind,COALESCE(r."occurrenceKey",''),r.title,r.detail,r.data,'pending'
      FROM jsonb_to_recordset(p_recommendations) r(kind text,"occurrenceKey" text,title text,detail text,data jsonb)
    ON CONFLICT(user_id,block_id,kind,occurrence_key) DO NOTHING;
  INSERT INTO public.engine_override_events(id,user_id,event_type,context) VALUES(receipt_id,u,'custom',
    jsonb_build_object('kind','program-progression-v1','programOwnershipVersion',1,'blockId',p_block_id,
      'instanceId',p_instance_id,'sessionId',p_session_id));
  RETURN 'applied';
END $$;
REVOKE ALL ON FUNCTION public.commit_program_progression(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commit_program_progression(uuid,uuid,uuid,jsonb,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.set_swim_rehab_bindings(p_plan_id uuid,p_protocol_ids uuid[],p_expected_revision text,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); input jsonb; receipt jsonb; result jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_protocol_ids IS NULL OR cardinality(p_protocol_ids)>20
    OR EXISTS(SELECT 1 FROM unnest(p_protocol_ids) id GROUP BY id HAVING count(*)<>1 OR id IS NULL) THEN
    RAISE EXCEPTION 'Choose each rehab protocol once.' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  input:=jsonb_build_object('planId',p_plan_id,'protocolIds',to_jsonb(p_protocol_ids));
  SELECT context INTO receipt FROM public.engine_override_events WHERE id=p_request_id AND user_id=u;
  IF FOUND THEN
    IF receipt->>'kind' IS DISTINCT FROM 'swim-rehab-bindings-v1' OR receipt->'input' IS DISTINCT FROM input THEN
      RAISE EXCEPTION 'This request was used for a different change.' USING ERRCODE='22023';
    END IF;
    RETURN receipt->'result';
  END IF;
  IF p_expected_revision IS DISTINCT FROM public.training_schedule_snapshot()->>'revision' THEN
    RAISE EXCEPTION 'Your schedule changed. Review the attachments again.' USING ERRCODE='40001';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.swim_plans WHERE id=p_plan_id AND user_id=u AND status IN ('active','paused')) THEN
    RAISE EXCEPTION 'This swimming program cannot be edited.' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.swim_plan_rehab_bindings WHERE plan_id=p_plan_id AND user_id=u;
  INSERT INTO public.swim_plan_rehab_bindings(plan_id,local_protocol_id,rehab_protocol_id,user_id)
    SELECT p_plan_id,id::text,id,u FROM unnest(p_protocol_ids) id;
  result:=jsonb_build_object('planId',p_plan_id,'protocolIds',to_jsonb(p_protocol_ids));
  INSERT INTO public.engine_override_events(id,user_id,event_type,context) VALUES(p_request_id,u,'custom',
    jsonb_build_object('kind','swim-rehab-bindings-v1','programOwnershipVersion',1,'input',input,'result',result));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.set_swim_rehab_bindings(uuid,uuid[],text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_swim_rehab_bindings(uuid,uuid[],text,uuid) TO authenticated;

CREATE FUNCTION public.guard_swim_rehab_session()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE origin jsonb; workout public.swim_workouts%ROWTYPE; protocol_id uuid; receipt_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.prescription->'meta' ? 'swimRehab' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.prescription IS DISTINCT FROM OLD.prescription THEN
      RAISE EXCEPTION 'This rehab workout keeps its issued protocol and swimming program.' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.prescription->'meta' ? 'swimRehab',false) THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Start attached rehab from its swimming workout.' USING ERRCODE='22023'; END IF;
  origin:=NEW.prescription#>'{meta,swimRehab}';
  protocol_id:=(origin->>'protocolId')::uuid;
  SELECT w.* INTO workout FROM public.swim_workouts w JOIN public.swim_plans p ON p.id=w.plan_id AND p.user_id=w.user_id
    WHERE w.id=(origin->>'workoutId')::uuid AND w.user_id=NEW.user_id AND w.user_id=auth.uid()
      AND p.id=(origin->>'planId')::uuid AND p.status IN ('active','finished') AND w.status<>'skipped';
  IF NOT FOUND OR origin->>'scheduledDate' IS DISTINCT FROM workout.scheduled_date::text
    OR origin->>'version' IS DISTINCT FROM '1' OR NOT EXISTS(
      SELECT 1 FROM public.swim_plan_rehab_bindings WHERE plan_id=workout.plan_id AND user_id=NEW.user_id AND rehab_protocol_id=protocol_id
    ) THEN RAISE EXCEPTION 'This attached rehab workout is no longer available.' USING ERRCODE='22023'; END IF;
  PERFORM public.validate_owned_rehab_items(NEW.prescription->'items',protocol_id,(origin->>'protocolRevision')::integer);
  receipt_id:=md5('swim-rehab:'||NEW.user_id::text||':'||workout.id::text||':'||protocol_id::text)::uuid;
  IF EXISTS(SELECT 1 FROM public.engine_override_events WHERE id=receipt_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Reopen or restore the existing rehab workout.' USING ERRCODE='23505';
  END IF;
  INSERT INTO public.engine_override_events(id,user_id,event_type,context) VALUES(receipt_id,NEW.user_id,'custom',
    jsonb_build_object('kind','swim-rehab-start-v1','programOwnershipVersion',1,'origin',origin,'sessionId',NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER sessions_swim_rehab_origin BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_swim_rehab_session();
REVOKE ALL ON FUNCTION public.guard_swim_rehab_session() FROM PUBLIC,anon;

CREATE FUNCTION public.start_swim_rehab_session(p_workout_id uuid,p_protocol_id uuid,p_expected_revision text,p_prescription jsonb,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); receipt jsonb; receipt_id uuid; input jsonb; result uuid; deleted timestamptz;
  workout public.swim_workouts%ROWTYPE; protocol public.rehab_protocols%ROWTYPE;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A start request is required.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));
  input:=jsonb_build_object('workoutId',p_workout_id,'protocolId',p_protocol_id,'prescription',p_prescription);
  SELECT context INTO receipt FROM public.engine_override_events WHERE id=p_request_id AND user_id=u;
  IF FOUND THEN
    IF receipt->>'kind' IS DISTINCT FROM 'swim-rehab-request-v1' OR receipt->'input' IS DISTINCT FROM input THEN
      RAISE EXCEPTION 'This request was used for a different workout.' USING ERRCODE='22023';
    END IF;
    result:=(receipt->>'sessionId')::uuid;
  ELSE
    receipt_id:=md5('swim-rehab:'||u::text||':'||p_workout_id::text||':'||p_protocol_id::text)::uuid;
    SELECT context INTO receipt FROM public.engine_override_events WHERE id=receipt_id AND user_id=u;
    IF FOUND THEN
      IF receipt->>'kind' IS DISTINCT FROM 'swim-rehab-start-v1' THEN
        RAISE EXCEPTION 'The workout receipt could not be read.' USING ERRCODE='22023';
      END IF;
      result:=(receipt->>'sessionId')::uuid;
    END IF;
  END IF;
  IF result IS NOT NULL THEN
    SELECT deleted_at INTO deleted FROM public.sessions WHERE id=result AND user_id=u;
    IF NOT FOUND THEN RAISE EXCEPTION 'This rehab workout was permanently removed.' USING ERRCODE='22023'; END IF;
    IF deleted IS NOT NULL THEN RAISE EXCEPTION 'Restore this rehab workout from Trash first.' USING ERRCODE='22023'; END IF;
    RETURN result;
  END IF;
  IF p_expected_revision IS DISTINCT FROM public.training_schedule_snapshot()->>'revision' THEN
    RAISE EXCEPTION 'Your schedule changed. Review this workout again.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO workout FROM public.swim_workouts WHERE id=p_workout_id AND user_id=u;
  SELECT * INTO protocol FROM public.rehab_protocols WHERE id=p_protocol_id AND user_id=u;
  IF workout.id IS NULL OR protocol.id IS NULL THEN RAISE EXCEPTION 'Workout or rehab protocol not found.' USING ERRCODE='22023'; END IF;
  IF p_prescription#>>'{meta,swimRehab,workoutId}' IS DISTINCT FROM p_workout_id::text
    OR p_prescription#>>'{meta,swimRehab,protocolId}' IS DISTINCT FROM p_protocol_id::text THEN
    RAISE EXCEPTION 'The rehab origin does not match this workout.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.sessions(user_id,title,slot,prescription)
    VALUES(u,protocol.name,workout.slot,p_prescription) RETURNING id INTO result;
  INSERT INTO public.engine_override_events(id,user_id,event_type,context) VALUES(p_request_id,u,'custom',
    jsonb_build_object('kind','swim-rehab-request-v1','programOwnershipVersion',1,'input',input,'sessionId',result));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.start_swim_rehab_session(uuid,uuid,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_swim_rehab_session(uuid,uuid,text,jsonb,uuid) TO authenticated;
