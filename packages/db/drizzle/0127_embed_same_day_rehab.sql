-- Fold untouched same-day rehab + strength pairs into one planned prescription.
-- The strength row remains canonical, so starting the workout still links exactly
-- one planned row and every existing prescription_item_index consumer stays valid.
-- Started, skipped, scheduled, noted, or user-edited rows are deliberately frozen.

WITH candidates AS MATERIALIZED (
  SELECT
    strength.id AS strength_id,
    rehab.id AS rehab_id,
    COALESCE(
      rehab.prescription->>'programRef',
      'rehab-row-' || rehab.id::text
    ) AS source_ref,
    CASE
      WHEN COALESCE(rehab.prescription->>'programRef', '') ~ '^rehab-.+-w[0-9]+-d[0-9]+$'
        THEN regexp_replace(
          rehab.prescription->>'programRef',
          '^rehab-(.+)-w[0-9]+-d[0-9]+$',
          '\1'
        )
      ELSE NULL
    END AS protocol_id,
    CASE
      WHEN rehab.title LIKE 'Rehab · %'
        THEN substring(rehab.title FROM char_length('Rehab · ') + 1)
      ELSE 'Rehab'
    END AS protocol_name,
    (
      SELECT COALESCE(
        jsonb_agg(
          item.value ||
          jsonb_build_object(
            'meta',
            COALESCE(item.value->'meta', '{}'::jsonb) ||
            jsonb_build_object(
              'rehab', true,
              'rehabProtocolId',
                CASE
                  WHEN COALESCE(rehab.prescription->>'programRef', '') ~ '^rehab-.+-w[0-9]+-d[0-9]+$'
                    THEN regexp_replace(
                      rehab.prescription->>'programRef',
                      '^rehab-(.+)-w[0-9]+-d[0-9]+$',
                      '\1'
                    )
                  ELSE NULL
                END,
              'rehabProtocolName',
                CASE
                  WHEN rehab.title LIKE 'Rehab · %'
                    THEN substring(rehab.title FROM char_length('Rehab · ') + 1)
                  ELSE 'Rehab'
                END,
              'rehabSourceRef',
                COALESCE(
                  rehab.prescription->>'programRef',
                  'rehab-row-' || rehab.id::text
                ),
              'rehabPlacement', 'during_warmup'
            )
          )
          ORDER BY item.ordinality
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(rehab.prescription->'items')
        WITH ORDINALITY AS item(value, ordinality)
    ) AS tagged_rehab_items,
    (
      SELECT COALESCE(
        jsonb_agg(item.value ORDER BY item.ordinality),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(strength.prescription->'items')
        WITH ORDINALITY AS item(value, ordinality)
      WHERE COALESCE((item.value->'meta'->>'rehab')::boolean, false) = false
    ) AS core_items,
    jsonb_build_object(
      'protocolId',
        CASE
          WHEN COALESCE(rehab.prescription->>'programRef', '') ~ '^rehab-.+-w[0-9]+-d[0-9]+$'
            THEN regexp_replace(
              rehab.prescription->>'programRef',
              '^rehab-(.+)-w[0-9]+-d[0-9]+$',
              '\1'
            )
          ELSE NULL
        END,
      'protocolName',
        CASE
          WHEN rehab.title LIKE 'Rehab · %'
            THEN substring(rehab.title FROM char_length('Rehab · ') + 1)
          ELSE 'Rehab'
        END,
      'sourceRef',
        COALESCE(
          rehab.prescription->>'programRef',
          'rehab-row-' || rehab.id::text
        ),
      'placement', 'during_warmup',
      'itemCount', jsonb_array_length(rehab.prescription->'items'),
      'movementCount', (
        SELECT count(DISTINCT item.value->>'movementId')
        FROM jsonb_array_elements(rehab.prescription->'items') AS item(value)
      ),
      'migrationSource', jsonb_build_object(
        'migration', '0127_embed_same_day_rehab',
        'plannedSessionId', rehab.id,
        'originalStrengthPrescription', strength.prescription,
        'originalStrengthRow', jsonb_build_object(
          'id', strength.id,
          'blockId', strength.block_id,
          'userId', strength.user_id,
          'weekIndex', strength.week_index,
          'dayIndex', strength.day_index,
          'slot', strength.slot,
          'title', strength.title,
          'role', strength.role
        ),
        'originalRehabRow', jsonb_build_object(
          'id', rehab.id,
          'slot', rehab.slot,
          'title', rehab.title,
          'role', rehab.role,
          'prescription', rehab.prescription,
          'completedSessionId', rehab.completed_session_id,
          'skippedAt', rehab.skipped_at,
          'plannedAt', rehab.planned_at,
          'sessionModality', rehab.session_modality,
          'effectiveStressLoad', rehab.effective_stress_load,
          'notes', rehab.notes,
          'createdAt', rehab.created_at
        )
      )
    ) AS section_metadata
  FROM public.planned_sessions AS strength
  JOIN public.planned_sessions AS rehab
    ON rehab.block_id = strength.block_id
   AND rehab.user_id = strength.user_id
   AND rehab.week_index = strength.week_index
   AND rehab.day_index = strength.day_index
   AND rehab.role = 'rehab'
  JOIN public.training_blocks AS block
    ON block.id = strength.block_id
   AND block.user_id = strength.user_id
  WHERE block.status = 'active'
    AND block.deleted_at IS NULL
    AND strength.role = 'strength'
    AND strength.completed_session_id IS NULL
    AND rehab.completed_session_id IS NULL
    AND strength.skipped_at IS NULL
    AND rehab.skipped_at IS NULL
    AND strength.planned_at IS NULL
    AND rehab.planned_at IS NULL
    AND COALESCE(btrim(strength.notes), '') = ''
    AND COALESCE(btrim(rehab.notes), '') = ''
    AND COALESCE(strength.prescription->'userEdited', 'false'::jsonb) <> 'true'::jsonb
    AND COALESCE(rehab.prescription->'userEdited', 'false'::jsonb) <> 'true'::jsonb
    AND jsonb_typeof(strength.prescription->'items') = 'array'
    AND jsonb_typeof(rehab.prescription->'items') = 'array'
    AND jsonb_array_length(rehab.prescription->'items') > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(strength.prescription->'items') AS item(value)
      WHERE COALESCE(item.value->'meta'->'rehab', 'false'::jsonb) = 'true'::jsonb
         OR COALESCE(item.value->'meta'->'userAdded', 'false'::jsonb) = 'true'::jsonb
         OR item.value->'meta' ? 'swappedFrom'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(rehab.prescription->'items') AS item(value)
      WHERE COALESCE(item.value->'meta'->'userAdded', 'false'::jsonb) = 'true'::jsonb
         OR item.value->'meta' ? 'swappedFrom'
    )
    AND (
      SELECT count(*)
      FROM public.planned_sessions AS same_day_strength
      WHERE same_day_strength.block_id = strength.block_id
        AND same_day_strength.week_index = strength.week_index
        AND same_day_strength.day_index = strength.day_index
        AND same_day_strength.role = 'strength'
    ) = 1
    AND (
      SELECT count(*)
      FROM public.planned_sessions AS same_day_rehab
      WHERE same_day_rehab.block_id = strength.block_id
        AND same_day_rehab.week_index = strength.week_index
        AND same_day_rehab.day_index = strength.day_index
        AND same_day_rehab.role = 'rehab'
    ) = 1
  FOR UPDATE OF strength, rehab, block
),
updated AS (
  UPDATE public.planned_sessions AS strength
  SET prescription = jsonb_set(
    jsonb_set(
      strength.prescription,
      '{items}',
      candidates.tagged_rehab_items || candidates.core_items,
      false
    ),
    '{meta}',
    COALESCE(strength.prescription->'meta', '{}'::jsonb) ||
    jsonb_build_object(
      'embeddedRehabSections',
      COALESCE(
        strength.prescription#>'{meta,embeddedRehabSections}',
        '[]'::jsonb
      ) || jsonb_build_array(candidates.section_metadata - 'migrationSource'),
      'embeddedRehabMigrationSources',
      COALESCE(
        strength.prescription#>'{meta,embeddedRehabMigrationSources}',
        '[]'::jsonb
      ) || jsonb_build_array(
        jsonb_build_object(
          'migrationSource',
          candidates.section_metadata->'migrationSource'
        )
      )
    ),
    true
  )
  FROM candidates
  WHERE strength.id = candidates.strength_id
  RETURNING candidates.rehab_id
)
DELETE FROM public.planned_sessions AS rehab
USING updated
WHERE rehab.id = updated.rehab_id;

-- Completion and the rehab-coverage check must be one transaction. The client
-- still explains the gate and offers bulk skip, but direct/offline RPC callers
-- cannot complete while a rehab prescription index remains unresolved.
CREATE OR REPLACE FUNCTION public.complete_training_session(
  p_session_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.planned_sessions AS planned
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(planned.prescription->'items', '[]'::jsonb)
    ) WITH ORDINALITY AS item(value, ordinality)
    WHERE planned.completed_session_id = p_session_id
      AND COALESCE(
        (item.value->'meta'->>'rehab')::boolean,
        false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.set_logs AS logged
        WHERE logged.session_id = p_session_id
          AND logged.prescription_item_index = item.ordinality - 1
      )
  ) THEN
    RAISE EXCEPTION
      'Log or skip all rehab sets before finishing.';
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
        /
        NULLIF(
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
        WHEN COUNT(*) >= 2 THEN
          NULLIF(
            LEAST(
              180,
              ROUND(
                EXTRACT(
                  EPOCH FROM (
                    MAX(logged.created_at) - MIN(logged.created_at)
                  )
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
         completed_at = now()
    FROM metrics
   WHERE session.id = p_session_id
     AND session.user_id = auth.uid()
  RETURNING session.user_id INTO v_user_id;

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_training_session(uuid, text)
  TO authenticated;

-- Forward rewrites must update preserved strength rows, delete regenerable rows,
-- and insert replacements as one transaction. Snapshot predicates turn a
-- concurrent start, note, reschedule, or prescription edit into a full rollback.
CREATE OR REPLACE FUNCTION public.rewrite_planned_sessions_atomically(
  p_block_id uuid,
  p_strength_updates jsonb,
  p_deletions jsonb,
  p_insertions jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_rows integer;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.training_blocks AS block
    WHERE block.id = p_block_id
      AND block.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Training block not found.';
  END IF;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_strength_updates, '[]'::jsonb))
  LOOP
    UPDATE public.planned_sessions AS planned
       SET prescription = v_entry->'prescription'
     WHERE planned.id = (v_entry->>'id')::uuid
       AND planned.block_id = p_block_id
       AND planned.user_id = v_user_id
       AND planned.week_index = (v_entry->>'weekIndex')::smallint
       AND planned.day_index = (v_entry->>'dayIndex')::smallint
       AND planned.slot = (v_entry->>'slot')::session_slot
       AND planned.role = 'strength'
       AND planned.completed_session_id IS NULL
       AND planned.skipped_at IS NULL
       AND planned.prescription = v_entry->'currentPrescription';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION
        'This plan changed while rehab was updating. Reload and try again.';
    END IF;
  END LOOP;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_deletions, '[]'::jsonb))
  LOOP
    DELETE FROM public.planned_sessions AS planned
     WHERE planned.id = (v_entry->>'id')::uuid
       AND planned.block_id = p_block_id
       AND planned.user_id = v_user_id
       AND planned.week_index = (v_entry->>'weekIndex')::smallint
       AND planned.day_index = (v_entry->>'dayIndex')::smallint
       AND planned.slot = (v_entry->>'slot')::session_slot
       AND planned.role = v_entry->>'role'
       AND planned.completed_session_id IS NULL
       AND planned.skipped_at IS NULL
       AND planned.planned_at IS NULL
       AND COALESCE(btrim(planned.notes), '') = ''
       AND planned.prescription = v_entry->'currentPrescription';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION
        'This plan changed while upcoming workouts were updating. Reload and try again.';
    END IF;
  END LOOP;

  INSERT INTO public.planned_sessions (
    block_id,
    user_id,
    week_index,
    day_index,
    slot,
    title,
    role,
    prescription,
    session_modality,
    effective_stress_load
  )
  SELECT
    p_block_id,
    v_user_id,
    inserted.week_index,
    inserted.day_index,
    inserted.slot,
    inserted.title,
    inserted.role,
    inserted.prescription,
    inserted.session_modality,
    inserted.effective_stress_load
  FROM jsonb_to_recordset(COALESCE(p_insertions, '[]'::jsonb)) AS inserted(
    week_index smallint,
    day_index smallint,
    slot session_slot,
    title text,
    role text,
    prescription jsonb,
    session_modality text,
    effective_stress_load numeric
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rewrite_planned_sessions_atomically(
  uuid,
  jsonb,
  jsonb,
  jsonb
) TO authenticated;
