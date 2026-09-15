-- ADR0086 / DC-SW8: reuse the existing identity helper, not managed-auth grants.
DO $migration$
DECLARE
  target record;
  before_proc pg_catalog.pg_proc%ROWTYPE;
  after_proc pg_catalog.pg_proc%ROWTYPE;
  helper pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO STRICT helper FROM pg_catalog.pg_proc
    WHERE oid = 'public.swim_request_user_id()'::regprocedure;
  IF current_user <> 'postgres'
    OR helper.proowner <> 'postgres'::regrole OR NOT helper.prosecdef
    OR helper.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
    OR encode(sha256(convert_to(helper.prosrc, 'UTF8')), 'hex') <>
      'c628b78ce1d2a3b15ddbaf7b0a5838fa26c925d332103e53f34ba73b9b227604'
    OR has_function_privilege('conditioning_writer', helper.oid, 'EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='conditioning_writer'
      AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit)) THEN
    RAISE EXCEPTION 'CONDITIONING_IDENTITY_BASELINE';
  END IF;
  FOR target IN SELECT * FROM (VALUES
    ('public.deploy_program_instance_atomically(jsonb,jsonb,jsonb,jsonb)',
      '74d3685c77b386841fdcc3856c0d20210b4c1b2be84fba09c6c7574835960bb3',
      '220faa039558e5305544e530df485ae8225863c7f09e9de5744988ff702500ba'),
    ('public.swim_conditioning_replay(uuid,jsonb)',
      '39b91a0319aa9e39676a9bbe23f5361ce9204de54586adae9e75b04b449317ba',
      '94dbaacad07182d9b3091e37ee7e2362d3a990fec91b2a2ae0b1c6aede4d03aa'),
    ('public.deploy_program_with_swimming(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)',
      '1bc92c25c7182d1f0ad62d8331f0960c8d9f77d082b0bbd64449bed6d9ea634d',
      '7be5be32114a13d2e2e6da9e6614c0e422a0dfae18f30757d0999c2c75e5970a'),
    ('public.swim_change_conditioning(uuid,jsonb)',
      '1e23bf301d3f400ebcf327883ec64483bb6031a5333b982bc8fbef5b6d3af126',
      '1dbb512bb5fc4c534969d71060fac10a45a0a40d5c8f001c7029ccfdbd5a9d53'),
    ('public.swim_lock_conditioning_program(uuid)',
      '237816a5cf50cdb6dd0014ec5d308ca2fed7145724b69377e6fe711a36411bc3',
      'a68a15da343c547d3e498052a37ce34c176a668c092a435134e7105b671a351e')
  ) AS targets(signature, original_hash, repaired_hash)
  LOOP
    SELECT * INTO STRICT before_proc FROM pg_catalog.pg_proc WHERE oid = target.signature::regprocedure;
    IF encode(sha256(convert_to(before_proc.prosrc, 'UTF8')), 'hex') <> target.original_hash THEN
      RAISE EXCEPTION 'CONDITIONING_IDENTITY_SOURCE_CHANGED';
    END IF;
    EXECUTE replace(pg_get_functiondef(before_proc.oid), 'auth.uid()', 'public.swim_request_user_id()');
    SELECT * INTO STRICT after_proc FROM pg_catalog.pg_proc WHERE oid = before_proc.oid;
    IF encode(sha256(convert_to(after_proc.prosrc, 'UTF8')), 'hex') <> target.repaired_hash
      OR to_jsonb(before_proc) - 'prosrc' IS DISTINCT FROM to_jsonb(after_proc) - 'prosrc' THEN
      RAISE EXCEPTION 'CONDITIONING_IDENTITY_REPAIR_CHANGED';
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.swim_request_user_id() TO conditioning_writer;
END $migration$;
