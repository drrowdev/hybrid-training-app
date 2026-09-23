-- DC-SW5/SW6/SW7/SW8: standalone claims, separate from measurements and primary programs.
ALTER TABLE public.swim_import_matches ADD CONSTRAINT swim_import_matches_owned_workout_id_key
  UNIQUE (user_id, workout_id, id);

CREATE TABLE public.swim_import_outcomes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id uuid NOT NULL,
  match_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  metadata jsonb NOT NULL CHECK (
    jsonb_typeof(metadata) = 'object'
    AND metadata ?& ARRAY['outcome', 'previousOutcomeId', 'workoutRevision']
    AND ((
      (match_id IS NULL AND metadata->'outcome' = 'null'::jsonb AND metadata->'workoutRevision' = 'null'::jsonb)
      OR (match_id IS NOT NULL AND metadata->>'outcome' IN ('completed', 'stopped_early')
        AND jsonb_typeof(metadata->'workoutRevision') = 'number'
        AND (metadata->>'workoutRevision')::numeric BETWEEN 1 AND 2147483647
        AND trunc((metadata->>'workoutRevision')::numeric) = (metadata->>'workoutRevision')::numeric)
    ) IS TRUE)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swim_import_outcomes_owner_revision_key UNIQUE (user_id, workout_id, revision),
  CONSTRAINT swim_import_outcomes_owned_workout_fk FOREIGN KEY (user_id, workout_id)
    REFERENCES public.swim_workouts(user_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT swim_import_outcomes_owned_match_fk FOREIGN KEY (user_id, workout_id, match_id)
    REFERENCES public.swim_import_matches(user_id, workout_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.swim_import_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY swim_import_outcomes_owner ON public.swim_import_outcomes
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.swim_import_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_import_outcomes TO authenticated;
GRANT SELECT, INSERT ON public.swim_import_outcomes TO swim_writer;

CREATE VIEW public.swim_current_import_outcomes WITH (security_invoker = true) AS
  SELECT DISTINCT ON (user_id, workout_id) *
  FROM public.swim_import_outcomes ORDER BY user_id, workout_id, revision DESC;
REVOKE ALL ON public.swim_current_import_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_current_import_outcomes TO authenticated;

CREATE FUNCTION public.swim_import_outcomes_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT true $$;

CREATE FUNCTION public.swim_confirm_import_outcome(
  p_request_id uuid, p_workout_id uuid, p_match_id uuid, p_outcome text,
  p_expected_outcome_id uuid, p_expected_workout_revision integer
)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = on
AS $$
DECLARE
  u uuid := public.swim_request_user_id();
  previous public.swim_import_outcomes;
  replay public.swim_import_outcomes;
  m public.swim_import_matches;
  w public.swim_workouts;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'SWIM_OUTCOME_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_workout_id IS NULL
     OR (p_outcome IS NULL AND (p_match_id IS NOT NULL OR p_expected_workout_revision IS NOT NULL))
     OR (p_outcome IS NOT NULL AND (p_outcome NOT IN ('completed', 'stopped_early')
       OR p_match_id IS NULL OR p_expected_workout_revision IS NULL OR p_expected_workout_revision < 1)) THEN
    RAISE EXCEPTION 'SWIM_OUTCOME_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;
  -- Schedule changes precede recording locks in the shared owner ordering.
  PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));
  -- Receiver corrections, rematches and confirmations share one owner ordering.
  PERFORM pg_advisory_xact_lock(hashtextextended('swim-import:' || u::text, 0));
  SELECT * INTO w FROM public.swim_workouts WHERE id = p_workout_id AND user_id = u FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_OUTCOME_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO previous FROM public.swim_import_outcomes
    WHERE user_id = u AND workout_id = w.id ORDER BY revision DESC LIMIT 1;
  SELECT * INTO replay FROM public.swim_import_outcomes WHERE user_id = u AND id = p_request_id;
  IF FOUND THEN
    IF replay.workout_id IS DISTINCT FROM p_workout_id OR replay.match_id IS DISTINCT FROM p_match_id
       OR replay.metadata->>'outcome' IS DISTINCT FROM p_outcome
       OR replay.metadata->>'previousOutcomeId' IS DISTINCT FROM p_expected_outcome_id::text
       OR (replay.metadata->>'workoutRevision')::integer IS DISTINCT FROM p_expected_workout_revision THEN
      RAISE EXCEPTION 'SWIM_OUTCOME_REQUEST_REUSED' USING ERRCODE = '22023';
    END IF;
    IF previous.id IS DISTINCT FROM replay.id THEN
      RAISE EXCEPTION 'SWIM_OUTCOME_CHANGED' USING ERRCODE = '40001';
    END IF;
  ELSIF previous.id IS DISTINCT FROM p_expected_outcome_id THEN
    RAISE EXCEPTION 'SWIM_OUTCOME_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF p_outcome IS NOT NULL THEN
    SELECT * INTO m FROM public.swim_import_matches
      WHERE id = p_match_id AND user_id = u AND workout_id = w.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SWIM_OUTCOME_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.swim_import_matches
       WHERE user_id = u AND activity_id = m.activity_id AND revision > m.revision)
       OR EXISTS (SELECT 1 FROM public.swim_imports
         WHERE user_id = u AND activity_id = m.activity_id
           AND revision > (SELECT revision FROM public.swim_imports WHERE id = m.import_id AND user_id = u))
       OR w.revision <> p_expected_workout_revision
       OR (m.metadata->'workout'->>'revision')::integer IS DISTINCT FROM w.revision THEN
      RAISE EXCEPTION 'SWIM_OUTCOME_SOURCE_CHANGED' USING ERRCODE = '40001';
    END IF;
    IF w.status <> 'scheduled' OR w.session_id IS NOT NULL THEN
      RAISE EXCEPTION 'SWIM_OUTCOME_ALREADY_SETTLED' USING ERRCODE = '22023';
    END IF;
  ELSIF replay.id IS NULL AND (previous.id IS NULL OR previous.match_id IS NULL) THEN
    RAISE EXCEPTION 'SWIM_OUTCOME_NOT_CONFIRMED' USING ERRCODE = '22023';
  END IF;
  IF replay.id IS NOT NULL THEN RETURN replay.id; END IF;
  INSERT INTO public.swim_import_outcomes (id, user_id, workout_id, match_id, revision, metadata)
    VALUES (p_request_id, u, w.id, p_match_id, COALESCE(previous.revision, 0) + 1,
      jsonb_build_object('outcome', p_outcome, 'previousOutcomeId', previous.id,
        'workoutRevision', p_expected_workout_revision));
  RETURN p_request_id;
END $$;

GRANT CREATE ON SCHEMA public TO swim_writer;
ALTER FUNCTION public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer) OWNER TO swim_writer;
REVOKE CREATE ON SCHEMA public FROM swim_writer;
REVOKE ALL ON FUNCTION public.swim_import_outcomes_ready(),
  public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swim_import_outcomes_ready(),
  public.swim_confirm_import_outcome(uuid,uuid,uuid,text,uuid,integer) TO authenticated;

CREATE VIEW public.swim_import_outcome_activity WITH (security_invoker = true) AS
SELECT w.user_id, w.id, w.plan_id, w.revision, w.status, w.session_id,
  w.scheduled_date, w.slot, w.definition, sp.status AS plan_status,
  logged.id AS visible_session_id, logged.completed_at AS native_completed_at,
  o.id AS outcome_id, o.match_id AS outcome_match_id, o.metadata AS outcome_metadata,
  m.id AS current_match_id, m.import_id AS matched_import_id,
  (m.metadata#>>'{workout,revision}')::integer AS matched_workout_revision,
  latest.id AS latest_import_id, latest.evidence->>'date' AS recording_date,
  claimed_recording.id AS claim_import_id,
  claimed_recording.evidence->>'date' AS claim_recording_date
FROM public.swim_workouts w
JOIN public.swim_plans sp ON sp.id = w.plan_id AND sp.user_id = w.user_id
LEFT JOIN public.sessions logged
  ON logged.id = w.session_id AND logged.user_id = w.user_id AND logged.deleted_at IS NULL
LEFT JOIN public.swim_current_import_outcomes o
  ON o.workout_id = w.id AND o.user_id = w.user_id
LEFT JOIN public.swim_import_matches claimed_match
  ON claimed_match.id = o.match_id AND claimed_match.workout_id = w.id AND claimed_match.user_id = w.user_id
LEFT JOIN public.swim_imports claimed_recording
  ON claimed_recording.id = claimed_match.import_id AND claimed_recording.user_id = w.user_id
LEFT JOIN public.swim_current_import_matches m
  ON m.id = o.match_id AND m.workout_id = w.id AND m.user_id = w.user_id
LEFT JOIN LATERAL (
  SELECT i.id, i.evidence FROM public.swim_imports i
  WHERE i.user_id = w.user_id AND i.activity_id = m.activity_id
  ORDER BY i.revision DESC LIMIT 1
) latest ON true;
REVOKE ALL ON public.swim_import_outcome_activity FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.swim_import_outcome_activity TO authenticated;
