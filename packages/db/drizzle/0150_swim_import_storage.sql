-- ADR0081: observations only; no session, prescription or workload writes.
CREATE FUNCTION public.swim_import_keys(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object' THEN
    p_value ?& p_keys AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_value) AS keys(key) WHERE NOT (key = ANY(p_keys))
    ) ELSE false END
$$;

CREATE FUNCTION public.swim_import_number(p_value jsonb, p_max numeric, p_integer boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN
    (p_value #>> '{}')::numeric BETWEEN 0 AND p_max
    AND (NOT p_integer OR trunc((p_value #>> '{}')::numeric) = (p_value #>> '{}')::numeric)
  ELSE false END
$$;

CREATE FUNCTION public.swim_import_evidence_valid(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE d jsonb; s jsonb; k text; v_date date;
BEGIN
  IF p_value IS NULL OR pg_column_size(p_value) > 1048576
     OR NOT public.swim_import_keys(p_value, ARRAY[
       'version','source','activityId','date','environment','workoutReference',
       'distanceMetres','recordedDurationMs','durationKind','nativeCourse','detail'
     ]) THEN RETURN false; END IF;
  IF p_value->'version' <> '1'::jsonb
     OR p_value->>'source' <> 'local_dashboard'
     OR jsonb_typeof(p_value->'activityId') <> 'string'
     OR (p_value->>'activityId') !~ '^[0-9]{1,24}$'
     OR (p_value->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR p_value->>'environment' NOT IN ('pool','open_water')
     OR p_value->>'durationKind' <> 'unspecified'
     OR p_value->'nativeCourse' <> 'null'::jsonb
     OR NOT public.swim_import_number(p_value->'distanceMetres', 1000000, false)
     OR NOT public.swim_import_number(p_value->'recordedDurationMs', 86400000, true)
     THEN RETURN false; END IF;
  -- JSON null must not bypass a comparison through SQL's unknown truth value.
  IF jsonb_typeof(p_value->'source') <> 'string'
     OR jsonb_typeof(p_value->'date') <> 'string'
     OR jsonb_typeof(p_value->'environment') <> 'string'
     OR jsonb_typeof(p_value->'durationKind') <> 'string'
     THEN RETURN false; END IF;
  v_date := (p_value->>'date')::date;
  IF to_char(v_date, 'YYYY-MM-DD') <> p_value->>'date' THEN RETURN false; END IF;
  IF p_value->'workoutReference' <> 'null'::jsonb AND (
     jsonb_typeof(p_value->'workoutReference') <> 'string'
     OR (p_value->>'workoutReference') !~ '^[0-9]{1,24}$'
  ) THEN RETURN false; END IF;
  d := p_value->'detail';
  IF NOT public.swim_import_keys(d, ARRAY['status','fetchedAt','splits'])
     OR jsonb_typeof(d->'status') <> 'string'
     OR d->>'status' NOT IN ('missing','partial','available','unverified')
     OR jsonb_typeof(d->'splits') <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(d->'splits') > 2000 THEN RETURN false; END IF;
  IF d->'fetchedAt' <> 'null'::jsonb THEN
    IF jsonb_typeof(d->'fetchedAt') <> 'string' OR length(d->>'fetchedAt') > 40
       OR (d->>'fetchedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$'
       THEN RETURN false; END IF;
    v_date := left(d->>'fetchedAt', 10)::date;
    IF to_char(v_date, 'YYYY-MM-DD') <> left(d->>'fetchedAt', 10) THEN RETURN false; END IF;
  END IF;
  IF d->>'status' = 'missing' AND
     (d->'fetchedAt' <> 'null'::jsonb OR jsonb_array_length(d->'splits') <> 0)
     THEN RETURN false; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(d->'splits') LOOP
    IF NOT public.swim_import_keys(s, ARRAY[
      'distanceMetres','elapsedMs','reportedActiveMs','activeTimeVerified',
      'reportedPauseMs','stroke','strokeKnown','activeLengths','workoutStep'
    ]) OR s->'activeTimeVerified' <> 'false'::jsonb
       OR jsonb_typeof(s->'strokeKnown') <> 'boolean' THEN RETURN false; END IF;
    IF s->'distanceMetres' <> 'null'::jsonb
       AND NOT public.swim_import_number(s->'distanceMetres', 1000000, false) THEN RETURN false; END IF;
    FOREACH k IN ARRAY ARRAY['elapsedMs','reportedActiveMs','reportedPauseMs'] LOOP
      IF s->k <> 'null'::jsonb AND NOT public.swim_import_number(s->k, 86400000, true)
         THEN RETURN false; END IF;
    END LOOP;
    IF s->'activeLengths' <> 'null'::jsonb
       AND NOT public.swim_import_number(s->'activeLengths', 2000, true) THEN RETURN false; END IF;
    IF s->'workoutStep' <> 'null'::jsonb
       AND NOT public.swim_import_number(s->'workoutStep', 10000, true) THEN RETURN false; END IF;
    IF s->'stroke' <> 'null'::jsonb AND (
       jsonb_typeof(s->'stroke') <> 'string'
       OR s->>'stroke' NOT IN ('freestyle','backstroke','breaststroke','butterfly','mixed','drill')
    ) THEN RETURN false; END IF;
    IF s->'strokeKnown' <> to_jsonb(s->'stroke' <> 'null'::jsonb) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN false;
END $$;

CREATE TABLE public.swim_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CONSTRAINT swim_connections_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (user_id, id)
);
CREATE UNIQUE INDEX swim_connections_one_active_per_user
  ON public.swim_connections(user_id) WHERE revoked_at IS NULL;

CREATE TABLE public.swim_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  activity_id text NOT NULL CONSTRAINT swim_imports_activity_id_check CHECK (activity_id ~ '^[0-9]{1,24}$'),
  revision integer NOT NULL CONSTRAINT swim_imports_revision_check CHECK (revision > 0),
  content_hash text NOT NULL CONSTRAINT swim_imports_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swim_imports_owned_connection_fk FOREIGN KEY (user_id, connection_id)
    REFERENCES public.swim_connections(user_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_imports_owner_activity_revision_key UNIQUE (user_id, activity_id, revision),
  CONSTRAINT swim_imports_owner_activity_content_key UNIQUE (user_id, activity_id, content_hash),
  CONSTRAINT swim_imports_evidence_check CHECK (
    public.swim_import_evidence_valid(evidence) AND activity_id = evidence->>'activityId'
  )
);
ALTER TABLE public.swim_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swim_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_connections_owner ON public.swim_connections
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY swim_imports_owner ON public.swim_imports
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.swim_connections, public.swim_imports FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, user_id, created_at, revoked_at) ON public.swim_connections TO authenticated;
GRANT SELECT ON public.swim_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.swim_connections TO swim_writer;
GRANT SELECT, UPDATE (revoked_at) ON public.swim_connections TO service_role;
GRANT SELECT, INSERT ON public.swim_imports TO service_role;

CREATE FUNCTION public.swim_import_storage_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT true $$;

CREATE FUNCTION public.swim_import_connect(p_hash text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE u uuid := public.swim_request_user_id(); c public.swim_connections; new_id uuid;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'SWIM_IMPORT_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SWIM_IMPORT_INVALID_KEY' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || u::text, 0));
  SELECT * INTO c FROM public.swim_connections WHERE user_id = u AND revoked_at IS NULL;
  IF FOUND THEN
    IF c.token_hash = p_hash THEN RETURN c.id; END IF;
    RAISE EXCEPTION 'SWIM_IMPORT_ALREADY_CONNECTED' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.swim_connections(user_id, token_hash) VALUES (u, p_hash) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE FUNCTION public.swim_import_disconnect(p_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE u uuid := public.swim_request_user_id();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'SWIM_IMPORT_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  UPDATE public.swim_connections SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = p_id AND user_id = u;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_IMPORT_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.swim_import_receive(p_hash text, p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE c public.swim_connections; r public.swim_imports; h text; n integer;
BEGIN
  IF current_user <> 'service_role' OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SWIM_IMPORT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.swim_connections WHERE token_hash = p_hash AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_IMPORT_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF NOT public.swim_import_evidence_valid(p_evidence) THEN
    RAISE EXCEPTION 'SWIM_IMPORT_INVALID_EVIDENCE' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || c.user_id::text, 0));
  h := encode(sha256(convert_to(p_evidence::text, 'UTF8')), 'hex');
  SELECT * INTO r FROM public.swim_imports
    WHERE user_id = c.user_id AND activity_id = p_evidence->>'activityId' AND content_hash = h;
  IF FOUND THEN RETURN jsonb_build_object('id', r.id, 'revision', r.revision, 'replayed', true); END IF;
  SELECT COALESCE(max(revision), 0) + 1 INTO n FROM public.swim_imports
    WHERE user_id = c.user_id AND activity_id = p_evidence->>'activityId';
  INSERT INTO public.swim_imports(user_id, connection_id, activity_id, revision, content_hash, evidence)
    VALUES (c.user_id, c.id, p_evidence->>'activityId', n, h, p_evidence) RETURNING * INTO r;
  RETURN jsonb_build_object('id', r.id, 'revision', r.revision, 'replayed', false);
END $$;

GRANT CREATE ON SCHEMA public TO swim_writer;
ALTER FUNCTION public.swim_import_connect(text) OWNER TO swim_writer;
ALTER FUNCTION public.swim_import_disconnect(uuid) OWNER TO swim_writer;
REVOKE CREATE ON SCHEMA public FROM swim_writer;
REVOKE ALL ON FUNCTION public.swim_import_keys(jsonb,text[]),
  public.swim_import_number(jsonb,numeric,boolean), public.swim_import_evidence_valid(jsonb),
  public.swim_import_storage_ready(), public.swim_import_connect(text),
  public.swim_import_disconnect(uuid), public.swim_import_receive(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_import_keys(jsonb,text[]),
  public.swim_import_number(jsonb,numeric,boolean), public.swim_import_evidence_valid(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.swim_import_storage_ready() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_import_connect(text), public.swim_import_disconnect(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swim_import_receive(text,jsonb) TO service_role;
