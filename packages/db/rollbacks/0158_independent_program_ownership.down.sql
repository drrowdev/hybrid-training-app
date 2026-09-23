BEGIN;
SET LOCAL search_path=public;
LOCK TABLE public.training_blocks,public.program_instances,public.planned_sessions,public.sessions,
  public.engine_override_events,public.rehab_protocols,public.program_rehab_bindings,public.swim_plan_rehab_bindings,
  public.training_seasons,public.season_blocks
  IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE entry record; routine oid;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('guard_program_block_identity()','6da67a2d95608a326ff6aa1986d06ee9'),
    ('guard_program_instance_identity()','6d044cde36189b33e46ec53c14402b99'),
    ('sync_program_instance_lifecycle()','e936f86cfc009442125b2843e8cec03f'),
    ('check_program_parent_consistency()','6e967bbbea37749b44eb958d6c3b17a9'),
    ('validate_owned_rehab_items(jsonb,uuid,integer)','e8c6d5b14524af1db05f244678727fc5'),
    ('guard_program_prescription()','79a4796d81aa589658934d384431c75f'),
    ('independent_programs_ready()','f7754db18b4915afa6efd55215665840'),
    ('independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean)','9ae72d954b4fde78db1fb2a1bcdd7831'),
    ('complete_program_if_settled(uuid)','996fb16023d56e0d29a0e96963ada556'),
    ('commit_program_progression(uuid,uuid,uuid,jsonb,jsonb,jsonb)','7d4d6b811d1f78996349e92b26bdb639'),
    ('set_swim_rehab_bindings(uuid,uuid[],text,uuid)','2329636561cb53b0160e3bd24bf5a737'),
    ('guard_swim_rehab_session()','643414add07d5638fe29d9d6c106cb90'),
    ('start_swim_rehab_session(uuid,uuid,text,jsonb,uuid)','465b37b8aba6a5ed966ac3d0df205f92')
  ) expected(signature,fingerprint) LOOP
    routine:=to_regprocedure('public.'||entry.signature);
    IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=routine
      AND md5(replace(prosrc,E'\r\n',E'\n'))=entry.fingerprint
      AND NOT prosecdef AND NOT proleakproof AND NOT proisstrict AND proparallel='u'
      AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND proconfig=ARRAY['search_path=pg_catalog, public'])
      OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=routine AND (a.grantee=0 OR a.grantee=(SELECT oid FROM pg_roles WHERE rolname='anon'))) THEN
      RAISE EXCEPTION 'An independent-program routine changed; rollback refused: %',entry.signature;
    END IF;
  END LOOP;
  FOR entry IN SELECT * FROM (VALUES
    ('training_blocks_one_active_per_kind',2,'program_kind','status = ''active''::training_block_status AND deleted_at IS NULL AND program_kind IS NOT NULL'),
    ('training_blocks_one_active_legacy',1,NULL,'status = ''active''::training_block_status AND deleted_at IS NULL AND program_kind IS NULL'),
    ('program_instances_one_active_per_block',2,'block_id','status = ''active''::text AND deleted_at IS NULL AND block_id IS NOT NULL'),
    ('program_instances_one_active_orphan',1,NULL,'status = ''active''::text AND deleted_at IS NULL AND block_id IS NULL')
  ) expected(name,columns,second_column,predicate) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.'||entry.name)
      AND i.indisunique AND i.indisvalid AND i.indnatts=entry.columns
      AND pg_get_indexdef(i.indexrelid,1,true)='user_id'
      AND (entry.columns=1 OR pg_get_indexdef(i.indexrelid,2,true)=entry.second_column)
      AND regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[()]','','g')=entry.predicate) THEN
      RAISE EXCEPTION 'An independent-program index changed; rollback refused: %',entry.name;
    END IF;
  END LOOP;
  FOR entry IN SELECT * FROM (VALUES
    ('training_blocks','training_blocks_program_identity','guard_program_block_identity()',23,false),
    ('training_blocks','training_blocks_instance_lifecycle','sync_program_instance_lifecycle()',17,false),
    ('training_blocks','training_blocks_parent_consistency','check_program_parent_consistency()',21,true),
    ('program_instances','program_instances_program_identity','guard_program_instance_identity()',23,false),
    ('program_instances','program_instances_parent_consistency','check_program_parent_consistency()',29,true),
    ('planned_sessions','planned_sessions_program_prescription','guard_program_prescription()',23,false),
    ('sessions','sessions_swim_rehab_origin','guard_swim_rehab_session()',23,false),
    ('rehab_protocols','rehab_protocols_schedule_lock','training_schedule_lock()',30,false),
    ('program_rehab_bindings','program_rehab_bindings_schedule_lock','training_schedule_lock()',30,false),
    ('training_seasons','training_seasons_schedule_lock','training_schedule_lock()',30,false),
    ('season_blocks','season_blocks_schedule_lock','training_schedule_lock()',30,false),
    ('swim_plan_rehab_bindings','swim_plan_rehab_bindings_schedule_lock','training_schedule_lock()',30,false)
  ) expected(relation,name,routine,type,deferred) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.'||entry.relation)
      AND tgname=entry.name AND tgfoid=to_regprocedure('public.'||entry.routine) AND tgenabled='O'
      AND tgtype=entry.type AND tgdeferrable=entry.deferred AND tginitdeferred=entry.deferred
      AND tgqual IS NULL AND tgnargs=0) THEN
      RAISE EXCEPTION 'An independent-program trigger changed; rollback refused: %',entry.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.swim_plan_rehab_bindings'::regclass
      AND attnum>0 AND NOT attisdropped)<>5
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.swim_plan_rehab_bindings'::regclass AND NOT tgisinternal)<>1
    OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.swim_plan_rehab_bindings'::regclass)<>1
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.swim_plan_rehab_bindings'::regclass)<>6
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.swim_plan_rehab_bindings'::regclass
      AND polname='swim_plan_rehab_bindings_owner' AND polcmd='*' AND polroles::text='{0}'
      AND regexp_replace(pg_get_expr(polqual,polrelid),'\s','','g')='(auth.uid()=user_id)'
      AND regexp_replace(pg_get_expr(polwithcheck,polrelid),'\s','','g')='(auth.uid()=user_id)')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.program_instances'::regclass
      AND conname='program_instances_block_id_fkey'
      AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id, block_id) REFERENCES training_blocks(user_id, id) ON DELETE SET NULL (block_id)')
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.planned_sessions'::regclass
      AND conname='planned_sessions_block_id_fkey'
      AND pg_get_constraintdef(oid)='FOREIGN KEY (user_id, block_id) REFERENCES training_blocks(user_id, id) ON DELETE CASCADE') THEN
    RAISE EXCEPTION 'Independent-program storage changed; rollback refused.';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.training_blocks WHERE program_kind IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.swim_plan_rehab_bindings)
    OR EXISTS(SELECT 1 FROM public.sessions WHERE prescription->'meta' ? 'swimRehab')
    OR EXISTS(SELECT 1 FROM public.engine_override_events WHERE context ? 'programOwnershipVersion'
      OR context->>'kind'='swim-rehab-start-v1')
    OR EXISTS(SELECT user_id FROM public.training_blocks WHERE status='active' AND deleted_at IS NULL GROUP BY user_id HAVING count(*)>1)
    OR EXISTS(SELECT user_id FROM public.program_instances WHERE status='active' AND deleted_at IS NULL GROUP BY user_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Independent programs or rehab have been used. Retain history and deploy a forward repair; rollback refused.';
  END IF;
END $$;
DO $$
DECLARE entry record; routine oid; body text; definition text; attributes jsonb; restored text;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb)', '0538a9e3e6ec8ba5fa711f6d0436ba15',
      E'\n  -- ADR0087 refuse the old archive-all deployment entrypoint.\n  RAISE EXCEPTION ''Refresh program setup before saving.'' USING ERRCODE = ''55000'';'),
    ('public.update_program_instance_atomically(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'c3b72f4a3cac2ac588aef6bc109c4904',
      E'\n  -- ADR0087 typed programs never overwrite an account loading percentage.\n  IF EXISTS (SELECT 1 FROM public.training_blocks WHERE id = p_block_id AND user_id = auth.uid() AND program_kind IS NOT NULL)\n    AND COALESCE(p_tm_percents, ''[]''::jsonb) <> ''[]''::jsonb THEN\n    RAISE EXCEPTION ''Refresh program load settings before saving.'' USING ERRCODE = ''55000'';\n  END IF;')
  ) AS baseline(signature,fingerprint,guard) LOOP
    routine:=to_regprocedure(entry.signature);
    SELECT prosrc,pg_get_functiondef(oid),jsonb_build_array(proowner,prosecdef,proconfig,proacl::text)
      INTO body,definition,attributes FROM pg_proc WHERE oid=routine;
    restored:=replace(body,entry.guard,'');
    IF routine IS NULL OR restored IS NOT DISTINCT FROM body
      OR md5(replace(restored,E'\r\n',E'\n')) IS DISTINCT FROM entry.fingerprint THEN
      RAISE EXCEPTION 'A program RPC changed after independent programs; rollback refused: %',entry.signature;
    END IF;
    EXECUTE replace(definition,body,restored);
    IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
      IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Program RPC permissions changed unexpectedly.'; END IF;
  END LOOP;
END $$;
DO $$
DECLARE routine oid:=to_regprocedure('public.training_schedule_snapshot()'); body text; definition text; attributes jsonb; restored text;
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
  restored:=replace(body,new_text,old_text);
  IF routine IS NULL OR restored IS NOT DISTINCT FROM body
    OR md5(replace(restored,E'\r\n',E'\n')) IS DISTINCT FROM '136f490e9b17d543848669a25eb03fa9' THEN
    RAISE EXCEPTION 'The schedule snapshot changed after independent programs; rollback refused.';
  END IF;
  EXECUTE replace(definition,body,restored);
  IF (SELECT jsonb_build_array(proowner,prosecdef,proconfig,proacl::text) FROM pg_proc WHERE oid=routine)
    IS DISTINCT FROM attributes THEN RAISE EXCEPTION 'Schedule snapshot permissions changed unexpectedly.'; END IF;
END $$;
DROP FUNCTION public.complete_program_if_settled(uuid);
DROP FUNCTION public.commit_program_progression(uuid,uuid,uuid,jsonb,jsonb,jsonb);
DROP FUNCTION public.start_swim_rehab_session(uuid,uuid,text,jsonb,uuid);
DROP FUNCTION public.set_swim_rehab_bindings(uuid,uuid[],text,uuid);
DROP TRIGGER sessions_swim_rehab_origin ON public.sessions;
DROP FUNCTION public.guard_swim_rehab_session();
DROP FUNCTION public.independent_program_schedule_commit(text,jsonb,text,uuid,text,boolean);
DROP FUNCTION public.independent_programs_ready();
DROP TRIGGER planned_sessions_program_prescription ON public.planned_sessions;
DROP FUNCTION public.guard_program_prescription();
DROP FUNCTION public.validate_owned_rehab_items(jsonb,uuid,integer);
DROP TABLE public.swim_plan_rehab_bindings;
DROP TRIGGER rehab_protocols_schedule_lock ON public.rehab_protocols;
DROP TRIGGER program_rehab_bindings_schedule_lock ON public.program_rehab_bindings;
DROP TRIGGER training_seasons_schedule_lock ON public.training_seasons;
DROP TRIGGER season_blocks_schedule_lock ON public.season_blocks;
ALTER TABLE public.rehab_protocols DROP CONSTRAINT rehab_protocols_user_id_id_key;
DROP TRIGGER training_blocks_parent_consistency ON public.training_blocks;
DROP TRIGGER program_instances_parent_consistency ON public.program_instances;
DROP FUNCTION public.check_program_parent_consistency();
DROP TRIGGER training_blocks_instance_lifecycle ON public.training_blocks;
DROP FUNCTION public.sync_program_instance_lifecycle();
DROP TRIGGER training_blocks_program_identity ON public.training_blocks;
DROP TRIGGER program_instances_program_identity ON public.program_instances;
DROP FUNCTION public.guard_program_block_identity();
DROP FUNCTION public.guard_program_instance_identity();
DROP INDEX public.training_blocks_one_active_per_kind;
DROP INDEX public.training_blocks_one_active_legacy;
DROP INDEX public.program_instances_one_active_per_block;
DROP INDEX public.program_instances_one_active_orphan;
CREATE UNIQUE INDEX training_blocks_one_visible_active_per_user ON public.training_blocks(user_id)
  WHERE status='active' AND deleted_at IS NULL;
CREATE UNIQUE INDEX program_instances_one_visible_active_per_user ON public.program_instances(user_id)
  WHERE status='active' AND deleted_at IS NULL;
ALTER TABLE public.program_instances DROP CONSTRAINT program_instances_block_id_fkey;
ALTER TABLE public.planned_sessions DROP CONSTRAINT planned_sessions_block_id_fkey;
ALTER TABLE public.program_instances ADD CONSTRAINT program_instances_block_id_fkey
  FOREIGN KEY(block_id) REFERENCES public.training_blocks(id) ON DELETE SET NULL;
ALTER TABLE public.planned_sessions ADD CONSTRAINT planned_sessions_block_id_fkey
  FOREIGN KEY(block_id) REFERENCES public.training_blocks(id) ON DELETE CASCADE;
ALTER TABLE public.training_blocks DROP CONSTRAINT training_blocks_user_id_id_key;
ALTER TABLE public.training_blocks DROP CONSTRAINT training_blocks_program_kind_check;
ALTER TABLE public.training_blocks DROP COLUMN program_kind;
COMMIT;
