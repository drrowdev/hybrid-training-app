-- Restore prior anonymous reachability and the known swimming-completion limitation.
BEGIN;

DO $migration$
DECLARE
  v_phase integer;
  v_amended boolean;
  v_shared pg_catalog.pg_proc%ROWTYPE;
  v_helper pg_catalog.pg_proc%ROWTYPE;
  v_postgres oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres');
  v_authenticated oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated');
  v_service oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role');
  v_writer oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'swim_writer');
  v_anon oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon');
  v_proc pg_catalog.pg_proc%ROWTYPE;
  v_expected oid[];
BEGIN
  IF current_user IS DISTINCT FROM 'postgres'
     OR v_postgres IS NULL OR v_authenticated IS NULL OR v_service IS NULL
     OR v_writer IS NULL OR v_anon IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'SCID/' || '1/roles/'
      || CASE WHEN v_phase = 1 THEN 'post' ELSE 'pre' END || '/roles/'
      || (SELECT string_agg(CASE WHEN bit THEN 't' WHEN NOT bit THEN 'f' ELSE 'u' END, '' ORDER BY position)
          FROM unnest(ARRAY[
            current_user IS NOT DISTINCT FROM 'postgres',
            v_postgres IS NOT NULL, v_authenticated IS NOT NULL, v_service IS NOT NULL,
            v_writer IS NOT NULL, v_anon IS NOT NULL
          ]) WITH ORDINALITY AS evidence(bit, position));
  END IF;

  -- Check the exact amended state before mutation and the exact prior state afterward.
  FOR v_phase IN 0..1 LOOP
    v_amended := v_phase = 0;
    SELECT * INTO v_shared FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure('public.complete_training_session_with_transition(uuid,text,uuid)');
    SELECT * INTO v_helper FROM pg_catalog.pg_proc
      WHERE oid = pg_catalog.to_regprocedure('public.swim_request_user_id()');

    IF v_shared.oid IS NULL OR v_helper.oid IS NULL
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_shared.prosrc, 'UTF8')), 'hex')
          IS DISTINCT FROM (CASE WHEN v_amended
            THEN 'cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d'
            ELSE '7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END)
       OR v_shared.proowner IS DISTINCT FROM v_postgres
       OR v_shared.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
       OR v_shared.prokind IS DISTINCT FROM 'f'
       OR v_shared.provolatile IS DISTINCT FROM 'v'
       OR v_shared.prosecdef IS DISTINCT FROM false
       OR v_shared.proleakproof IS DISTINCT FROM false
       OR v_shared.proisstrict IS DISTINCT FROM false
       OR v_shared.proparallel IS DISTINCT FROM 'u'
       OR v_shared.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
       OR v_shared.pronargs IS DISTINCT FROM 3::smallint
       OR v_shared.pronargdefaults IS DISTINCT FROM 1::smallint
       OR pg_catalog.pg_get_expr(v_shared.proargdefaults, 0) IS DISTINCT FROM 'NULL::uuid'
       OR v_shared.proargtypes IS DISTINCT FROM '2950 25 2950'::pg_catalog.oidvector
       OR v_shared.proallargtypes IS DISTINCT FROM ARRAY[2950,25,2950,2950,16]::oid[]
       OR v_shared.proargmodes IS DISTINCT FROM ARRAY['i','i','i','t','t']::"char"[]
       OR v_shared.proargnames IS DISTINCT FROM ARRAY['p_session_id','p_notes','p_completion_entry_id','user_id','transitioned']::text[]
       OR v_shared.prorettype IS DISTINCT FROM 'record'::pg_catalog.regtype
       OR v_shared.proretset IS DISTINCT FROM true
       OR v_shared.provariadic IS DISTINCT FROM 0::oid
       OR v_shared.prosupport IS DISTINCT FROM 0::pg_catalog.regproc
       OR v_shared.probin IS NOT NULL OR v_shared.prosqlbody IS NOT NULL
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_helper.prosrc, 'UTF8')), 'hex')
          IS DISTINCT FROM 'c628b78ce1d2a3b15ddbaf7b0a5838fa26c925d332103e53f34ba73b9b227604'
       OR v_helper.proowner IS DISTINCT FROM v_postgres
       OR v_helper.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql')
       OR v_helper.prokind IS DISTINCT FROM 'f'
       OR v_helper.provolatile IS DISTINCT FROM 's'
       OR v_helper.prosecdef IS DISTINCT FROM true
       OR v_helper.proleakproof IS DISTINCT FROM false
       OR v_helper.proisstrict IS DISTINCT FROM false
       OR v_helper.proparallel IS DISTINCT FROM 'u'
       OR v_helper.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
       OR v_helper.pronargs IS DISTINCT FROM 0::smallint
       OR v_helper.pronargdefaults IS DISTINCT FROM 0::smallint
       OR v_helper.proargdefaults IS NOT NULL
       OR v_helper.proargtypes IS DISTINCT FROM ''::pg_catalog.oidvector
       OR v_helper.proallargtypes IS NOT NULL OR v_helper.proargmodes IS NOT NULL
       OR v_helper.proargnames IS NOT NULL
       OR v_helper.prorettype IS DISTINCT FROM 'uuid'::pg_catalog.regtype
       OR v_helper.proretset IS DISTINCT FROM false
       OR v_helper.provariadic IS DISTINCT FROM 0::oid
       OR v_helper.prosupport IS DISTINCT FROM 0::pg_catalog.regproc
       OR v_helper.probin IS NOT NULL OR v_helper.prosqlbody IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'SCID/' || '1/attributes/'
        || CASE WHEN v_phase = 1 THEN 'post' ELSE 'pre' END || '/both/'
        || (SELECT string_agg(CASE WHEN bit THEN 't' WHEN NOT bit THEN 'f' ELSE 'u' END, '' ORDER BY position)
            FROM unnest(ARRAY[
              v_shared.oid IS NOT NULL, v_helper.oid IS NOT NULL,
              pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_shared.prosrc, 'UTF8')), 'hex')
                IS NOT DISTINCT FROM CASE WHEN v_amended
                  THEN 'cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d'
                  ELSE '7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' END,
              v_shared.proowner IS NOT DISTINCT FROM v_postgres,
              v_shared.prolang IS NOT DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql'),
              v_shared.prokind IS NOT DISTINCT FROM 'f',
              v_shared.provolatile IS NOT DISTINCT FROM 'v',
              v_shared.prosecdef IS NOT DISTINCT FROM false,
              v_shared.proleakproof IS NOT DISTINCT FROM false,
              v_shared.proisstrict IS NOT DISTINCT FROM false,
              v_shared.proparallel IS NOT DISTINCT FROM 'u',
              v_shared.proconfig IS NOT DISTINCT FROM ARRAY['search_path=public']::text[],
              v_shared.pronargs IS NOT DISTINCT FROM 3::smallint,
              v_shared.pronargdefaults IS NOT DISTINCT FROM 1::smallint,
              pg_catalog.pg_get_expr(v_shared.proargdefaults, 0) IS NOT DISTINCT FROM 'NULL::uuid',
              v_shared.proargtypes IS NOT DISTINCT FROM '2950 25 2950'::pg_catalog.oidvector,
              v_shared.proallargtypes IS NOT DISTINCT FROM ARRAY[2950,25,2950,2950,16]::oid[],
              v_shared.proargmodes IS NOT DISTINCT FROM ARRAY['i','i','i','t','t']::"char"[],
              v_shared.proargnames IS NOT DISTINCT FROM ARRAY['p_session_id','p_notes','p_completion_entry_id','user_id','transitioned']::text[],
              v_shared.prorettype IS NOT DISTINCT FROM 'record'::pg_catalog.regtype,
              v_shared.proretset IS NOT DISTINCT FROM true,
              v_shared.provariadic IS NOT DISTINCT FROM 0::oid,
              v_shared.prosupport IS NOT DISTINCT FROM 0::pg_catalog.regproc,
              v_shared.probin IS NULL, v_shared.prosqlbody IS NULL,
              pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_helper.prosrc, 'UTF8')), 'hex')
                IS NOT DISTINCT FROM 'c628b78ce1d2a3b15ddbaf7b0a5838fa26c925d332103e53f34ba73b9b227604',
              v_helper.proowner IS NOT DISTINCT FROM v_postgres,
              v_helper.prolang IS NOT DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql'),
              v_helper.prokind IS NOT DISTINCT FROM 'f',
              v_helper.provolatile IS NOT DISTINCT FROM 's',
              v_helper.prosecdef IS NOT DISTINCT FROM true,
              v_helper.proleakproof IS NOT DISTINCT FROM false,
              v_helper.proisstrict IS NOT DISTINCT FROM false,
              v_helper.proparallel IS NOT DISTINCT FROM 'u',
              v_helper.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']::text[],
              v_helper.pronargs IS NOT DISTINCT FROM 0::smallint,
              v_helper.pronargdefaults IS NOT DISTINCT FROM 0::smallint,
              v_helper.proargdefaults IS NULL,
              v_helper.proargtypes IS NOT DISTINCT FROM ''::pg_catalog.oidvector,
              v_helper.proallargtypes IS NULL, v_helper.proargmodes IS NULL,
              v_helper.proargnames IS NULL,
              v_helper.prorettype IS NOT DISTINCT FROM 'uuid'::pg_catalog.regtype,
              v_helper.proretset IS NOT DISTINCT FROM false,
              v_helper.provariadic IS NOT DISTINCT FROM 0::oid,
              v_helper.prosupport IS NOT DISTINCT FROM 0::pg_catalog.regproc,
              v_helper.probin IS NULL, v_helper.prosqlbody IS NULL
            ]) WITH ORDINALITY AS evidence(bit, position));
    END IF;

    FOR v_proc IN SELECT * FROM pg_catalog.pg_proc WHERE oid IN (v_shared.oid, v_helper.oid) LOOP
      v_expected := CASE WHEN v_proc.oid = v_shared.oid
        THEN ARRAY[v_postgres, v_authenticated, v_service, v_writer]
          || CASE WHEN v_amended THEN ARRAY[]::oid[] ELSE ARRAY[0]::oid[] END
        ELSE ARRAY[v_postgres, v_service, v_writer]
          || CASE WHEN v_amended THEN ARRAY[v_authenticated] ELSE ARRAY[]::oid[] END END;
      IF (SELECT array_agg(acl.grantee ORDER BY acl.grantee)
            FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl)
          IS DISTINCT FROM (SELECT array_agg(grantee ORDER BY grantee) FROM unnest(v_expected) grantee)
         OR (SELECT bool_and(acl.grantor = v_postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable)
            FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl)
          IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING MESSAGE = 'SCID/' || '1/acl/'
          || CASE WHEN v_phase = 1 THEN 'post' ELSE 'pre' END || '/'
          || CASE WHEN v_proc.oid = v_shared.oid THEN 'shared' ELSE 'helper' END || '/'
          || (SELECT string_agg(CASE WHEN bit THEN 't' WHEN NOT bit THEN 'f' ELSE 'u' END, '' ORDER BY position)
              FROM unnest(ARRAY[
                (SELECT array_agg(acl.grantee ORDER BY acl.grantee)
                   FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl)
                  IS NOT DISTINCT FROM (SELECT array_agg(grantee ORDER BY grantee) FROM unnest(v_expected) grantee),
                (SELECT bool_and(acl.grantor = v_postgres AND acl.privilege_type = 'EXECUTE' AND NOT acl.is_grantable)
                   FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl)
                  IS NOT DISTINCT FROM true,
                v_proc.proacl IS NULL,
                EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) acl WHERE acl.grantee = v_anon),
                EXISTS (SELECT 1 FROM pg_catalog.aclexplode(v_proc.proacl) acl WHERE acl.grantee = 0),
                (SELECT bool_and(acl.grantor = v_postgres)
                   FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl),
                (SELECT bool_and(acl.privilege_type = 'EXECUTE')
                   FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl),
                (SELECT bool_and(NOT acl.is_grantable)
                   FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl)
              ]) WITH ORDINALITY AS evidence(bit, position));
      END IF;
    END LOOP;

    IF pg_catalog.has_function_privilege(v_authenticated, v_shared.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_service, v_shared.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_writer, v_shared.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_postgres, v_shared.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_anon, v_shared.oid, 'EXECUTE') IS DISTINCT FROM (NOT v_amended)
       OR pg_catalog.has_function_privilege(v_authenticated, v_helper.oid, 'EXECUTE') IS DISTINCT FROM v_amended
       OR pg_catalog.has_function_privilege(v_service, v_helper.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_writer, v_helper.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_postgres, v_helper.oid, 'EXECUTE') IS DISTINCT FROM true
       OR pg_catalog.has_function_privilege(v_anon, v_helper.oid, 'EXECUTE') IS DISTINCT FROM false THEN
      RAISE EXCEPTION USING MESSAGE = 'SCID/' || '1/privileges/'
        || CASE WHEN v_phase = 1 THEN 'post' ELSE 'pre' END || '/both/'
        || (SELECT string_agg(CASE WHEN bit THEN 't' WHEN NOT bit THEN 'f' ELSE 'u' END, '' ORDER BY position)
            FROM unnest(ARRAY[
              pg_catalog.has_function_privilege(v_authenticated, v_shared.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_service, v_shared.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_writer, v_shared.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_postgres, v_shared.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_anon, v_shared.oid, 'EXECUTE') IS NOT DISTINCT FROM (NOT v_amended),
              pg_catalog.has_function_privilege(v_authenticated, v_helper.oid, 'EXECUTE') IS NOT DISTINCT FROM v_amended,
              pg_catalog.has_function_privilege(v_service, v_helper.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_writer, v_helper.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_postgres, v_helper.oid, 'EXECUTE') IS NOT DISTINCT FROM true,
              pg_catalog.has_function_privilege(v_anon, v_helper.oid, 'EXECUTE') IS NOT DISTINCT FROM false
            ]) WITH ORDINALITY AS evidence(bit, position));
    END IF;

    IF v_phase = 0 THEN
CREATE OR REPLACE FUNCTION public.complete_training_session_with_transition(
  p_session_id uuid,
  p_notes text,
  p_completion_entry_id uuid DEFAULT NULL
)
RETURNS TABLE(user_id uuid, transitioned boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sessions AS session
    WHERE session.id = p_session_id
      AND session.user_id = v_user_id
      AND session.deleted_at IS NULL
    FOR UPDATE
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sessions AS session
    WHERE session.id = p_session_id
      AND session.completed_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT v_user_id, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.planned_sessions AS planned
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(planned.prescription->'items', '[]'::jsonb)
    ) WITH ORDINALITY AS item(value, ordinality)
    WHERE planned.completed_session_id = p_session_id
      AND COALESCE((item.value->'meta'->>'rehab')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM public.set_logs AS logged
        WHERE logged.session_id = p_session_id
          AND logged.prescription_item_index = item.ordinality - 1
      )
  ) THEN
    RAISE EXCEPTION 'Log or skip all rehab sets before finishing.';
  END IF;

  WITH metrics AS (
    SELECT
      ROUND(
        SUM(logged.rpe * logged.weight_kg * logged.reps)
          FILTER (
            WHERE logged.rpe IS NOT NULL
              AND logged.weight_kg IS NOT NULL
              AND logged.reps IS NOT NULL
              AND logged.weight_kg > 0
              AND logged.reps > 0
          )
        / NULLIF(
          SUM(logged.weight_kg * logged.reps)
            FILTER (
              WHERE logged.rpe IS NOT NULL
                AND logged.weight_kg IS NOT NULL
                AND logged.reps IS NOT NULL
                AND logged.weight_kg > 0
                AND logged.reps > 0
            ),
          0
        ),
        1
      ) AS session_rpe,
      CASE
        WHEN COUNT(*) >= 2 THEN NULLIF(
          LEAST(
            180,
            ROUND(
              EXTRACT(
                EPOCH FROM (MAX(logged.created_at) - MIN(logged.created_at))
              ) / 60
            )::integer
          ),
          0
        )
        ELSE NULL
      END AS duration_min
    FROM public.set_logs AS logged
    WHERE logged.session_id = p_session_id
      AND logged.skipped = false
  )
  UPDATE public.sessions AS session
     SET session_rpe = metrics.session_rpe,
         duration_min = metrics.duration_min,
         notes = p_notes,
         completed_at = now(),
         completion_outbox_entry_id = COALESCE(
           session.completion_outbox_entry_id,
           p_completion_entry_id
         )
    FROM metrics
   WHERE session.id = p_session_id
     AND session.user_id = v_user_id
     AND session.completed_at IS NULL;

  RETURN QUERY SELECT v_user_id, true;
END;
$$;

      GRANT EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid, text, uuid) TO PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.swim_request_user_id() FROM authenticated;
    END IF;
  END LOOP;
END $migration$;

COMMIT;
