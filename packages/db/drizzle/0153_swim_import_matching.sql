-- ADR0084: explicit associations only, never workout completion or workload.
ALTER TABLE public.swim_imports ADD CONSTRAINT swim_imports_owned_activity_id_key
  UNIQUE (user_id, activity_id, id);
ALTER TABLE public.swim_workouts ADD CONSTRAINT swim_workouts_user_id_id_key UNIQUE (user_id, id);

CREATE TABLE public.swim_import_matches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  import_id uuid NOT NULL,
  workout_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swim_import_matches_owner_revision_key UNIQUE (user_id, activity_id, revision),
  CONSTRAINT swim_import_matches_owned_import_fk FOREIGN KEY (user_id, activity_id, import_id)
    REFERENCES public.swim_imports(user_id, activity_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_import_matches_owned_workout_fk FOREIGN KEY (user_id, workout_id)
    REFERENCES public.swim_workouts(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.swim_import_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_import_matches_owner ON public.swim_import_matches
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.swim_import_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_import_matches TO authenticated;
GRANT SELECT, INSERT ON public.swim_import_matches TO swim_writer;
GRANT SELECT ON public.swim_imports TO swim_writer;

CREATE VIEW public.swim_current_import_matches WITH (security_invoker = true) AS
  SELECT DISTINCT ON (user_id, activity_id) *
  FROM public.swim_import_matches
  ORDER BY user_id, activity_id, revision DESC;
REVOKE ALL ON public.swim_current_import_matches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_current_import_matches TO authenticated;

CREATE FUNCTION public.swim_import_matching_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT true $$;

CREATE FUNCTION public.swim_match_import(
  p_request_id uuid, p_import_id uuid, p_workout_id uuid,
  p_expected_match_id uuid, p_expected_workout_revision integer
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
DECLARE
  u uuid := public.swim_request_user_id();
  r public.swim_imports;
  previous public.swim_import_matches;
  replay public.swim_import_matches;
  w public.swim_workouts;
  snapshot jsonb := 'null'::jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'SWIM_MATCH_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_import_id IS NULL
     OR (p_workout_id IS NOT NULL AND (p_expected_workout_revision IS NULL OR p_expected_workout_revision < 1))
     OR (p_workout_id IS NULL AND p_expected_workout_revision IS NOT NULL) THEN
    RAISE EXCEPTION 'SWIM_MATCH_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  -- Share the receiver's owner lock: corrections and matches have a definite order.
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || u::text, 0));
  SELECT * INTO r FROM public.swim_imports WHERE id = p_import_id AND user_id = u;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_MATCH_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO previous FROM public.swim_import_matches
    WHERE user_id = u AND activity_id = r.activity_id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO replay FROM public.swim_import_matches WHERE id = p_request_id AND user_id = u;
  IF FOUND THEN
    IF replay.import_id IS DISTINCT FROM p_import_id OR replay.workout_id IS DISTINCT FROM p_workout_id
       OR replay.metadata->>'previousMatchId' IS DISTINCT FROM p_expected_match_id::text
       OR (replay.metadata->'workout'->>'revision')::integer IS DISTINCT FROM p_expected_workout_revision THEN
      RAISE EXCEPTION 'SWIM_MATCH_REQUEST_REUSED' USING ERRCODE = '22023';
    END IF;
    IF previous.id IS DISTINCT FROM replay.id THEN
      RAISE EXCEPTION 'SWIM_MATCH_CHANGED' USING ERRCODE = '40001';
    END IF;
    RETURN replay.id;
  END IF;
  IF previous.id IS DISTINCT FROM p_expected_match_id THEN
    RAISE EXCEPTION 'SWIM_MATCH_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF p_workout_id IS NOT NULL THEN
    IF r.evidence->>'environment' <> 'pool' THEN
      RAISE EXCEPTION 'SWIM_MATCH_POOL_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.swim_imports
      WHERE user_id = u AND activity_id = r.activity_id AND revision > r.revision) THEN
      RAISE EXCEPTION 'SWIM_MATCH_RECORDING_CHANGED' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO w FROM public.swim_workouts WHERE id = p_workout_id AND user_id = u FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_MATCH_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
    IF w.revision <> p_expected_workout_revision THEN
      RAISE EXCEPTION 'SWIM_MATCH_WORKOUT_CHANGED' USING ERRCODE = '40001';
    END IF;
    snapshot := jsonb_build_object(
      'revision', w.revision, 'date', w.scheduled_date,
      'title', COALESCE(w.definition->'courseSource'->>'title', 'Pool swim'),
      'issued', w.definition->'issued'
    );
  ELSIF previous.workout_id IS NULL THEN
    RAISE EXCEPTION 'SWIM_MATCH_NOT_ATTACHED' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.swim_import_matches(id, user_id, activity_id, import_id, workout_id, revision, metadata)
    VALUES (p_request_id, u, r.activity_id, r.id, p_workout_id, COALESCE(previous.revision, 0) + 1,
      jsonb_build_object('previousMatchId', previous.id, 'workout', snapshot));
  RETURN p_request_id;
END $$;

GRANT CREATE ON SCHEMA public TO swim_writer;
ALTER FUNCTION public.swim_match_import(uuid,uuid,uuid,uuid,integer) OWNER TO swim_writer;
REVOKE CREATE ON SCHEMA public FROM swim_writer;
REVOKE ALL ON FUNCTION public.swim_import_matching_ready(),
  public.swim_match_import(uuid,uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_import_matching_ready(),
  public.swim_match_import(uuid,uuid,uuid,uuid,integer) TO authenticated;
