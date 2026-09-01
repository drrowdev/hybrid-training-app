-- Make multi-row user workflows all-or-nothing. These functions run as the
-- signed-in user, retain normal RLS enforcement, and serialize the small
-- per-user critical sections that replace an active plan or season.

-- Preserve the newest visible row when upgrading installations that already
-- contain legacy active duplicates, then prevent new duplicates. Soft-deleted
-- rows remain valid history and deliberately do not participate.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rank
  FROM public.training_blocks
  WHERE status = 'active'
    AND deleted_at IS NULL
)
UPDATE public.training_blocks AS block
   SET status = 'archived',
       archived_at = COALESCE(block.archived_at, now()),
       ended_at = COALESCE(block.ended_at, now()),
       updated_at = now()
  FROM ranked
 WHERE block.id = ranked.id
   AND ranked.rank > 1;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rank
  FROM public.program_instances
  WHERE status = 'active'
    AND deleted_at IS NULL
)
UPDATE public.program_instances AS instance
   SET status = 'archived',
       updated_at = now()
  FROM ranked
 WHERE instance.id = ranked.id
   AND ranked.rank > 1;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC, id DESC
    ) AS rank
  FROM public.training_seasons
  WHERE status = 'active'
    AND deleted_at IS NULL
)
UPDATE public.training_seasons AS season
   SET status = 'abandoned',
       updated_at = now()
  FROM ranked
 WHERE season.id = ranked.id
   AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS training_blocks_one_visible_active_per_user
  ON public.training_blocks (user_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS program_instances_one_visible_active_per_user
  ON public.program_instances (user_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS training_seasons_one_visible_active_per_user
  ON public.training_seasons (user_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.deploy_program_instance_atomically(
  p_block jsonb,
  p_planned_sessions jsonb,
  p_tm_percents jsonb,
  p_program_instance jsonb
)
RETURNS TABLE(block_id uuid, program_instance_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_block_id uuid;
  v_instance_id uuid;
  v_entry jsonb;
  v_rows integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF jsonb_typeof(p_planned_sessions) <> 'array'
     OR jsonb_array_length(p_planned_sessions) = 0 THEN
    RAISE EXCEPTION 'This program produced no sessions — check your training maxes.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('program-deploy:' || v_user_id::text, 0)
  );

  UPDATE public.training_blocks
     SET status = 'archived',
         archived_at = COALESCE(archived_at, now()),
         ended_at = COALESCE(ended_at, now()),
         updated_at = now()
   WHERE user_id = v_user_id
     AND status = 'active';

  UPDATE public.program_instances
    SET status = 'archived',
         updated_at = now()
   WHERE user_id = v_user_id
     AND status = 'active';

  INSERT INTO public.training_blocks (
    user_id, archetype, program_id, program_family, started_on, weeks, status,
    days_per_week, day_index_overrides, cardio_source, allows_two_a_days,
    accessory_volume, notes
  )
  SELECT
    v_user_id, NULL, block.program_id, block.program_family, block.started_on,
    block.weeks, 'active', block.days_per_week, block.day_index_overrides,
    block.cardio_source, block.allows_two_a_days, block.accessory_volume,
    block.notes
  FROM jsonb_to_record(p_block) AS block(
    program_id text,
    program_family text,
    started_on date,
    weeks smallint,
    days_per_week smallint,
    day_index_overrides jsonb,
    cardio_source text,
    allows_two_a_days boolean,
    accessory_volume text,
    notes text
  )
  RETURNING id INTO v_block_id;
  IF v_block_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create block.';
  END IF;

  INSERT INTO public.planned_sessions (
    block_id, user_id, week_index, day_index, slot, title, role, prescription,
    session_modality, effective_stress_load
  )
  SELECT
    v_block_id, v_user_id, planned.week_index, planned.day_index, planned.slot,
    planned.title, planned.role, planned.prescription, planned.session_modality,
    planned.effective_stress_load
  FROM jsonb_to_recordset(p_planned_sessions) AS planned(
    week_index smallint,
    day_index smallint,
    slot session_slot,
    title text,
    role text,
    prescription jsonb,
    session_modality text,
    effective_stress_load numeric
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> jsonb_array_length(p_planned_sessions) THEN
    RAISE EXCEPTION 'Couldn''t create planned sessions.';
  END IF;

  FOR v_entry IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_tm_percents, '[]'::jsonb))
  LOOP
    UPDATE public.training_maxes
       SET tm_percent = (v_entry->>'tmPercent')::numeric
     WHERE user_id = v_user_id
       AND movement_id = (v_entry->>'movementId')::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 1 THEN
      RAISE EXCEPTION 'Couldn''t align training maxes.';
    END IF;
  END LOOP;

  INSERT INTO public.program_instances (
    user_id, program_id, program_family, display_name, customization_version,
    instance, setup_input, block_id, status
  )
  SELECT
    v_user_id, instance.program_id, instance.program_family,
    instance.display_name, instance.customization_version, instance.instance,
    instance.setup_input, v_block_id, 'active'
  FROM jsonb_to_record(p_program_instance) AS instance(
    program_id text,
    program_family text,
    display_name text,
    customization_version smallint,
    instance jsonb,
    setup_input jsonb
  )
  RETURNING id INTO v_instance_id;
  IF v_instance_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create program instance.';
  END IF;

  RETURN QUERY SELECT v_block_id, v_instance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deploy_program_instance_atomically(
  jsonb, jsonb, jsonb, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_program_instance_atomically(
  p_block_id uuid,
  p_strength_updates jsonb,
  p_deletions jsonb,
  p_insertions jsonb,
  p_block_metadata jsonb,
  p_tm_percents jsonb,
  p_program_instance jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_rows integer;
  v_instance_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('program-deploy:' || v_user_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.training_blocks
    WHERE id = p_block_id
      AND user_id = v_user_id
      AND status = 'active'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This plan is no longer active.';
  END IF;

  PERFORM public.rewrite_planned_sessions_atomically(
    p_block_id, p_strength_updates, p_deletions, p_insertions
  );

  UPDATE public.training_blocks AS block
     SET weeks = metadata.weeks,
         days_per_week = metadata.days_per_week,
         day_index_overrides = metadata.day_index_overrides,
         cardio_source = metadata.cardio_source,
         notes = metadata.notes,
         updated_at = now()
    FROM jsonb_to_record(p_block_metadata) AS metadata(
      weeks smallint,
      days_per_week smallint,
      day_index_overrides jsonb,
      cardio_source text,
      notes text
    )
   WHERE block.id = p_block_id
     AND block.user_id = v_user_id
     AND block.status = 'active'
     AND block.deleted_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'This plan is no longer active.';
  END IF;

  FOR v_entry IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_tm_percents, '[]'::jsonb))
  LOOP
    UPDATE public.training_maxes
       SET tm_percent = (v_entry->>'tmPercent')::numeric
     WHERE user_id = v_user_id
       AND movement_id = (v_entry->>'movementId')::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 1 THEN
      RAISE EXCEPTION 'Couldn''t align training maxes.';
    END IF;
  END LOOP;

  UPDATE public.program_instances AS instance
     SET instance = replacement.instance,
         setup_input = replacement.setup_input,
         display_name = replacement.display_name,
         customization_version = replacement.customization_version,
         updated_at = now()
    FROM jsonb_to_record(p_program_instance) AS replacement(
      instance jsonb,
      setup_input jsonb,
      display_name text,
      customization_version smallint
    )
   WHERE instance.block_id = p_block_id
     AND instance.user_id = v_user_id
     AND instance.status = 'active'
     AND instance.deleted_at IS NULL
  RETURNING instance.id INTO v_instance_id;
  IF v_instance_id IS NULL THEN
    RAISE EXCEPTION 'Active program instance not found.';
  END IF;

  RETURN v_instance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_program_instance_atomically(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_training_season_atomically(
  p_name text,
  p_goal jsonb,
  p_blocks jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_season_id uuid;
  v_rows integer;
  v_target_event_id uuid := NULLIF(p_goal->>'targetEventId', '')::uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF jsonb_typeof(p_blocks) <> 'array' OR jsonb_array_length(p_blocks) = 0 THEN
    RAISE EXCEPTION 'A season needs at least one block.';
  END IF;
  IF v_target_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.priority_events
    WHERE id = v_target_event_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Target event not found.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('training-season:' || v_user_id::text, 0)
  );

  UPDATE public.training_seasons
    SET status = 'abandoned',
         updated_at = now()
   WHERE user_id = v_user_id
     AND status = 'active';

  INSERT INTO public.training_seasons (
    user_id, name, goal_type, target_date, target_event_id, status
  )
  VALUES (
    v_user_id, p_name, NULLIF(p_goal->>'goalType', ''),
    NULLIF(p_goal->>'targetDate', '')::date, v_target_event_id, 'active'
  )
  RETURNING id INTO v_season_id;

  INSERT INTO public.season_blocks (
    season_id, user_id, position, program_id, template_ref, emphasis,
    intent_note, planned_weeks, status
  )
  SELECT
    v_season_id, v_user_id, block.position, block.program_id,
    block.template_ref, block.emphasis, block.intent_note, block.planned_weeks,
    'planned'
  FROM jsonb_to_recordset(p_blocks) AS block(
    position integer,
    program_id text,
    template_ref text,
    emphasis text,
    intent_note text,
    planned_weeks integer
  );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> jsonb_array_length(p_blocks) THEN
    RAISE EXCEPTION 'Couldn''t add the blocks.';
  END IF;

  RETURN v_season_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_training_season_atomically(
  text, jsonb, jsonb
) TO authenticated;

-- Keep the scalar completion RPC available for the previously deployed app.
-- The app calls this additive transition-aware variant after migration 0143;
-- it temporarily falls back to the scalar RPC while this migration is pending.
-- The nullable outbox entry is the receipt for an offline completion attempt.
-- It is retained with the completed session so a retry has a durable identity.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS completion_outbox_entry_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_completion_outbox_entry_per_user
  ON public.sessions (user_id, completion_outbox_entry_id)
  WHERE completion_outbox_entry_id IS NOT NULL;

COMMENT ON COLUMN public.sessions.completion_outbox_entry_id IS
  'Durable offline outbox entry that first completed this session; NULL for online completion.';

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

GRANT EXECUTE ON FUNCTION public.complete_training_session_with_transition(uuid, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_hyrox_session_actuals(
  p_session_id uuid,
  p_cardio_logs jsonb,
  p_set_logs jsonb,
  p_duration_min integer,
  p_session_rpe numeric,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sessions AS session
    WHERE session.id = p_session_id
      AND session.user_id = v_user_id
      AND session.deleted_at IS NULL
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Session not found.';
  END IF;

  DELETE FROM public.set_logs WHERE session_id = p_session_id;
  DELETE FROM public.cardio_logs WHERE session_id = p_session_id;

  INSERT INTO public.cardio_logs (
    session_id, movement_id, block_index, modality, duration_sec, rpe,
    avg_hr_bpm, hr_zones
  )
  SELECT
    p_session_id, cardio.movement_id, cardio.block_index, cardio.modality,
    cardio.duration_sec, cardio.rpe, cardio.avg_hr_bpm, cardio.hr_zones
  FROM jsonb_to_recordset(COALESCE(p_cardio_logs, '[]'::jsonb)) AS cardio(
    movement_id uuid,
    block_index smallint,
    modality text,
    duration_sec integer,
    rpe numeric,
    avg_hr_bpm smallint,
    hr_zones jsonb
  );

  INSERT INTO public.set_logs (
    session_id, movement_id, set_index, set_kind, weight_kg, reps,
    duration_sec, distance_m, rpe
  )
  SELECT
    p_session_id, logged.movement_id, logged.set_index, logged.set_kind,
    logged.weight_kg, logged.reps, logged.duration_sec, logged.distance_m,
    logged.rpe
  FROM jsonb_to_recordset(COALESCE(p_set_logs, '[]'::jsonb)) AS logged(
    movement_id uuid,
    set_index smallint,
    set_kind set_kind,
    weight_kg numeric,
    reps smallint,
    duration_sec integer,
    distance_m integer,
    rpe numeric
  );

  UPDATE public.sessions AS session
     SET completed_at = COALESCE(session.completed_at, now()),
         duration_min = p_duration_min,
         session_rpe = p_session_rpe,
         notes = p_notes,
         updated_at = now()
   WHERE session.id = p_session_id
     AND session.user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_hyrox_session_actuals(
  uuid, jsonb, jsonb, integer, numeric, text
) TO authenticated;

-- A dated measurement and the profile's current measurement are one user
-- action. Serialize them so overlapping submissions cannot leave the two
-- sources disagreeing if either write fails.
CREATE OR REPLACE FUNCTION public.log_bodyweight_atomically(
  p_date date,
  p_bodyweight_kg numeric,
  p_notes text DEFAULT NULL,
  p_replace_notes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('bodyweight-log:' || v_user_id::text, 0)
  );

  INSERT INTO public.wellness (
    user_id, date, bodyweight_kg, notes, updated_at
  )
  VALUES (
    v_user_id, p_date, p_bodyweight_kg, p_notes, now()
  )
  ON CONFLICT (user_id, date) DO UPDATE
    SET bodyweight_kg = EXCLUDED.bodyweight_kg,
        notes = CASE
          WHEN p_replace_notes THEN EXCLUDED.notes
          ELSE wellness.notes
        END,
        updated_at = now();

  -- A null daily measurement deliberately clears only the dated history,
  -- matching the old check-in behavior without erasing the current value.
  IF p_bodyweight_kg IS NOT NULL THEN
    UPDATE public.profiles
       SET bodyweight_kg = p_bodyweight_kg,
           updated_at = now()
     WHERE id = v_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Couldn''t update bodyweight.';
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_bodyweight_atomically(date, numeric, text, boolean)
  TO authenticated;

-- Signals that the app can rely on the atomic bodyweight-set trigger. The
-- app uses the absence of this additive RPC only during the app-first rollout
-- to keep the previously deployed reconciliation path working.
CREATE OR REPLACE FUNCTION public.atomic_user_workflows_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.atomic_user_workflows_ready() TO authenticated;

-- ADR 0074 — external load is an actual recorded against one set. It must be
-- preserved independently from weight_kg, which is not meaningful for all
-- bodyweight log shapes. Historical values remain NULL rather than guessed.
ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS external_load_kg numeric(6, 2);

COMMENT ON COLUMN public.set_logs.external_load_kg IS
  'ADR 0074 — actual added or assisted bodyweight load. NULL when not recorded.';

-- Bodyweight progress is derived from set_logs. Keep its compact history tied
-- to the set-log id so updates and deletes replace a contribution rather than
-- appending a second one. A per-family transaction lock serializes the
-- read-modify-write so overlapping same-family logs cannot lose progress.
CREATE TABLE IF NOT EXISTS public.bw_set_progress_contributions (
  set_log_id uuid PRIMARY KEY REFERENCES public.set_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  family text NOT NULL,
  node_id uuid NOT NULL REFERENCES public.movement_nodes(id) ON DELETE RESTRICT,
  tut_seconds integer NOT NULL CHECK (tut_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bw_set_progress_contributions_user_family_idx
  ON public.bw_set_progress_contributions (user_id, family);

ALTER TABLE public.bw_set_progress_contributions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bw_set_progress_contributions'
      AND policyname = 'bw_set_progress_contributions_self'
  ) THEN
    CREATE POLICY "bw_set_progress_contributions_self"
      ON public.bw_set_progress_contributions
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.bw_set_progress_contributions TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_bw_history_entry(
  p_history jsonb,
  p_log_id uuid,
  p_entry jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH retained AS (
    SELECT item.value, item.ordinality
    FROM jsonb_array_elements(COALESCE(p_history, '[]'::jsonb))
      WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value->>'set_log_id' IS DISTINCT FROM p_log_id::text
  ),
  appended AS (
    SELECT value, ordinality FROM retained
    UNION ALL
    SELECT p_entry, COALESCE((SELECT max(ordinality) FROM retained), 0) + 1
    WHERE p_entry IS NOT NULL
  ),
  capped AS (
    SELECT value, ordinality
    FROM appended
    ORDER BY ordinality DESC
    LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
  FROM capped;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_bw_progress_for_set_log(
  p_session_id uuid,
  p_prescription_item_index smallint,
  p_log_id uuid,
  p_reps smallint,
  p_duration_sec integer,
  p_rpe numeric,
  p_external_load_kg numeric,
  p_skipped boolean,
  p_direction integer,
  p_logged_at timestamptz,
  p_remove_contribution boolean DEFAULT true,
  p_is_update boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_bw jsonb;
  v_family text;
  v_delta integer := 0;
  v_entry jsonb;
  v_current_node_id uuid;
  v_recorded_node_id uuid;
  v_recorded_tut_seconds integer;
BEGIN
  IF v_user_id IS NULL OR p_prescription_item_index IS NULL THEN
    RETURN;
  END IF;

  SELECT item.value->'bw'
    INTO v_bw
    FROM public.planned_sessions AS planned
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(planned.prescription->'items', '[]'::jsonb)
    ) WITH ORDINALITY AS item(value, ordinality)
   WHERE planned.completed_session_id = p_session_id
     AND planned.user_id = v_user_id
     AND item.ordinality - 1 = p_prescription_item_index
     AND item.value ? 'bw'
   LIMIT 1;

  IF v_bw IS NULL OR NULLIF(v_bw->>'family', '') IS NULL THEN
    RETURN;
  END IF;
  v_family := v_bw->>'family';

  PERFORM pg_advisory_xact_lock(
   hashtextextended('bw-progress:' || v_user_id::text || ':' || v_family, 0)
  );

  SELECT progress.current_node_id
    INTO v_current_node_id
    FROM public.bw_progress AS progress
   WHERE progress.user_id = v_user_id
     AND progress.family = v_family;

  SELECT contribution.node_id, contribution.tut_seconds
      INTO v_recorded_node_id, v_recorded_tut_seconds
    FROM public.bw_set_progress_contributions AS contribution
   WHERE contribution.set_log_id = p_log_id
     AND contribution.user_id = v_user_id
     AND contribution.family = v_family;

  IF NOT p_skipped THEN
   CASE v_bw->>'prescriptionType'
     WHEN 'isometric_hold' THEN
       v_delta := GREATEST(0, COALESCE(p_duration_sec, 0));
     WHEN 'tempo_reps' THEN
       v_delta := ROUND(
         GREATEST(0, COALESCE(p_reps, 0))
         * GREATEST(0, COALESCE((v_bw->>'tempoEccentricSec')::numeric, 0))
         * 1.5
       );
     ELSE
       v_delta := ROUND(
         GREATEST(0, COALESCE(p_reps, 0))
         * GREATEST(0, COALESCE((v_bw->>'tempoEccentricSec')::numeric, 0))
       );
   END CASE;
  END IF;
  IF p_direction < 0 AND v_recorded_tut_seconds IS NOT NULL THEN
    v_delta := v_recorded_tut_seconds;
  END IF;

  -- Historic set logs predate durable per-set attribution. A later edit must
  -- not credit them again because their original contribution cannot be
  -- reliably attributed to a node. New INSERTs always create attribution.
  IF p_direction > 0 AND NOT (p_is_update AND v_recorded_node_id IS NULL) THEN
    IF v_recorded_node_id IS NULL AND v_current_node_id IS NOT NULL THEN
      INSERT INTO public.bw_set_progress_contributions (
        set_log_id, user_id, family, node_id, tut_seconds
      )
      VALUES (
        p_log_id, v_user_id, v_family, v_current_node_id, v_delta
      )
      ON CONFLICT (set_log_id) DO NOTHING
      RETURNING node_id INTO v_recorded_node_id;
      IF v_recorded_node_id IS NULL THEN
        SELECT contribution.node_id
          INTO v_recorded_node_id
          FROM public.bw_set_progress_contributions AS contribution
         WHERE contribution.set_log_id = p_log_id
           AND contribution.user_id = v_user_id
           AND contribution.family = v_family;
      END IF;
    ELSIF v_recorded_node_id IS NOT NULL THEN
      UPDATE public.bw_set_progress_contributions
         SET tut_seconds = v_delta
       WHERE set_log_id = p_log_id
         AND user_id = v_user_id
         AND family = v_family;
    END IF;
  END IF;

  v_entry := jsonb_strip_nulls(jsonb_build_object(
   'set_log_id', p_log_id,
   'date', to_char(p_logged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
   'rir', CASE WHEN p_rpe IS NULL THEN 2 ELSE GREATEST(0, 10 - p_rpe) END,
   'clean_form', CASE WHEN p_rpe IS NULL THEN true ELSE p_rpe <= 9 END,
   'reps', p_reps,
   'seconds', p_duration_sec,
   'prescribed_reps', NULLIF(v_bw->>'reps', '')::integer,
   'prescribed_hold', NULLIF(v_bw->>'holdSeconds', '')::integer,
   'node_id', v_recorded_node_id,
   'external_load_kg', NULLIF(p_external_load_kg, 0),
   'load_source', NULLIF(v_bw->>'loadSource', '')
  ));

  UPDATE public.bw_progress AS progress
    SET accumulated_tut_seconds = GREATEST(
           0,
           progress.accumulated_tut_seconds
           + CASE
               WHEN p_direction > 0
                AND v_recorded_node_id = progress.current_node_id
                 THEN v_delta
               WHEN p_direction < 0
                AND v_recorded_node_id = progress.current_node_id
                 THEN -v_delta
               ELSE 0
             END
         ),
         clean_rep_history = public.replace_bw_history_entry(
           progress.clean_rep_history,
           p_log_id,
           CASE
             WHEN p_direction > 0
              AND NOT p_skipped
               THEN v_entry
             ELSE NULL
           END
         ),
         updated_at = now()
   WHERE progress.user_id = v_user_id
     AND progress.family = v_family;

  IF p_direction < 0 AND p_remove_contribution THEN
   DELETE FROM public.bw_set_progress_contributions
    WHERE set_log_id = p_log_id
      AND user_id = v_user_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_bw_progress_from_set_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.reconcile_bw_progress_for_set_log(
      NEW.session_id, NEW.prescription_item_index, NEW.id, NEW.reps,
      NEW.duration_sec, NEW.rpe, NEW.external_load_kg, NEW.skipped, 1, NEW.created_at
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.reconcile_bw_progress_for_set_log(
      OLD.session_id, OLD.prescription_item_index, OLD.id, OLD.reps,
      OLD.duration_sec, OLD.rpe, OLD.external_load_kg, OLD.skipped, -1, OLD.created_at
    );
  ELSE
    PERFORM public.reconcile_bw_progress_for_set_log(
      OLD.session_id, OLD.prescription_item_index, OLD.id, OLD.reps,
      OLD.duration_sec, OLD.rpe, OLD.external_load_kg, OLD.skipped, -1, OLD.created_at,
      false
    );
    PERFORM public.reconcile_bw_progress_for_set_log(
      NEW.session_id, NEW.prescription_item_index, NEW.id, NEW.reps,
      NEW.duration_sec, NEW.rpe, NEW.external_load_kg, NEW.skipped, 1, NEW.created_at,
      true, true
    );
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_logs_reconcile_bw_progress_trg ON public.set_logs;
DROP TRIGGER IF EXISTS set_logs_reconcile_bw_progress_delete_trg ON public.set_logs;
CREATE TRIGGER set_logs_reconcile_bw_progress_trg
  AFTER INSERT OR UPDATE ON public.set_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_bw_progress_from_set_log();

CREATE TRIGGER set_logs_reconcile_bw_progress_delete_trg
  BEFORE DELETE ON public.set_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_bw_progress_from_set_log();

NOTIFY pgrst, 'reload schema';

-- Preserve existing TUT. Historic set logs did not store the node that was
-- current when they were recorded, so a whole-history rebuild could assign
-- prior-node work to the user's current node. New mutations capture the
-- current node in their history entry and reconcile from that durable record.
