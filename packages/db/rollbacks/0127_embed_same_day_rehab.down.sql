-- Recreate rows folded by 0127 and restore the byte-for-byte original strength
-- prescriptions. Abort on slot conflicts rather than silently losing rollback data.

DO $$
BEGIN
  LOCK TABLE public.planned_sessions IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.planned_sessions AS strength
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(
        NULLIF(
          strength.prescription#>'{meta,embeddedRehabMigrationSources}',
          '[]'::jsonb
        ),
        strength.prescription#>'{meta,embeddedRehabSections}',
        '[]'::jsonb
      )
    ) AS section(value)
    CROSS JOIN LATERAL (
      SELECT
        section.value#>'{migrationSource,originalStrengthPrescription}'
          AS prescription,
        section.value#>'{migrationSource,originalStrengthRow}' AS row,
        section.value#>'{migrationSource,originalRehabRow}' AS rehab_row
    ) AS original
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(item.value ORDER BY item.ordinality),
        '[]'::jsonb
      ) AS items
      FROM jsonb_array_elements(strength.prescription->'items')
        WITH ORDINALITY AS item(value, ordinality)
      WHERE COALESCE(
        (item.value->'meta'->>'rehab')::boolean,
        false
      ) = false
    ) AS current_core
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          (item.value - 'meta') ||
          CASE
            WHEN cleaned.value = '{}'::jsonb THEN '{}'::jsonb
            ELSE jsonb_build_object('meta', cleaned.value)
          END
          ORDER BY item.ordinality
        ),
        '[]'::jsonb
      ) AS items
      FROM jsonb_array_elements(strength.prescription->'items')
        WITH ORDINALITY AS item(value, ordinality)
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(item.value->'meta', '{}'::jsonb)
            - 'rehab'
            - 'rehabProtocolId'
            - 'rehabProtocolName'
            - 'rehabSourceRef'
            - 'rehabPlacement' AS value
      ) AS cleaned
      WHERE COALESCE(
        (item.value->'meta'->>'rehab')::boolean,
        false
      )
    ) AS current_rehab
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(
          (item.value - 'meta') ||
          CASE
            WHEN cleaned.value = '{}'::jsonb THEN '{}'::jsonb
            ELSE jsonb_build_object('meta', cleaned.value)
          END
          ORDER BY item.ordinality
        ),
        '[]'::jsonb
      ) AS items
      FROM jsonb_array_elements(
        COALESCE(original.rehab_row#>'{prescription,items}', '[]'::jsonb)
      ) WITH ORDINALITY AS item(value, ordinality)
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(item.value->'meta', '{}'::jsonb)
            - 'rehab'
            - 'rehabProtocolId'
            - 'rehabProtocolName'
            - 'rehabSourceRef'
            - 'rehabPlacement' AS value
      ) AS cleaned
    ) AS original_rehab
    CROSS JOIN LATERAL (
      SELECT
        (
          strength.prescription - 'items' - 'meta'
        ) ||
        jsonb_build_object('items', current_core.items) ||
        CASE
          WHEN COALESCE(
            (strength.prescription->'meta')
              - 'embeddedRehabSections'
              - 'embeddedRehabMigrationSources',
            '{}'::jsonb
          ) = '{}'::jsonb
            THEN '{}'::jsonb
          ELSE jsonb_build_object(
            'meta',
            (strength.prescription->'meta')
              - 'embeddedRehabSections'
              - 'embeddedRehabMigrationSources'
          )
        END AS prescription
    ) AS current_normalized
    CROSS JOIN LATERAL (
      SELECT
        (
          original.prescription - 'items' - 'meta'
        ) ||
        jsonb_build_object(
          'items',
          COALESCE(original.prescription->'items', '[]'::jsonb)
        ) ||
        CASE
          WHEN COALESCE(original.prescription->'meta', '{}'::jsonb) =
            '{}'::jsonb
            THEN '{}'::jsonb
          ELSE jsonb_build_object('meta', original.prescription->'meta')
        END AS prescription
    ) AS original_normalized
    WHERE section.value#>>'{migrationSource,migration}' =
      '0127_embed_same_day_rehab'
      AND (
        strength.completed_session_id IS NOT NULL
        OR strength.skipped_at IS NOT NULL
        OR strength.planned_at IS NOT NULL
        OR COALESCE(btrim(strength.notes), '') <> ''
        OR strength.block_id <> (original.row->>'blockId')::uuid
        OR strength.user_id <> (original.row->>'userId')::uuid
        OR strength.week_index <> (original.row->>'weekIndex')::smallint
        OR strength.day_index <> (original.row->>'dayIndex')::smallint
        OR strength.slot <> (original.row->>'slot')::session_slot
        OR strength.title <> original.row->>'title'
        OR strength.role <> original.row->>'role'
        OR current_rehab.items IS DISTINCT FROM original_rehab.items
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(strength.prescription->'items')
            AS current_rehab_item(value)
          WHERE COALESCE(
            (current_rehab_item.value->'meta'->>'rehab')::boolean,
            false
          )
            AND current_rehab_item.value#>>'{meta,rehabSourceRef}'
              IS DISTINCT FROM COALESCE(
                original.rehab_row#>>'{prescription,programRef}',
                'rehab-row-' || (original.rehab_row->>'id')
              )
        )
        OR current_normalized.prescription IS DISTINCT FROM
          original_normalized.prescription
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back 0127_embed_same_day_rehab: a folded workout was started or changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.planned_sessions AS strength
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(
        NULLIF(
          strength.prescription#>'{meta,embeddedRehabMigrationSources}',
          '[]'::jsonb
        ),
        strength.prescription#>'{meta,embeddedRehabSections}',
        '[]'::jsonb
      )
    ) AS section(value)
    JOIN public.planned_sessions AS conflict
      ON conflict.block_id = strength.block_id
     AND conflict.week_index = strength.week_index
     AND conflict.day_index = strength.day_index
     AND conflict.slot = (
       section.value#>>'{migrationSource,originalRehabRow,slot}'
     )::session_slot
     AND conflict.id <> (
       section.value#>>'{migrationSource,plannedSessionId}'
     )::uuid
    WHERE section.value#>>'{migrationSource,migration}' =
      '0127_embed_same_day_rehab'
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back 0127_embed_same_day_rehab: an original rehab slot is occupied';
  END IF;

  INSERT INTO public.planned_sessions (
    id,
    block_id,
    user_id,
    week_index,
    day_index,
    slot,
    planned_at,
    title,
    role,
    prescription,
    completed_session_id,
    skipped_at,
    session_modality,
    effective_stress_load,
    notes,
    created_at
  )
  SELECT
    (source.row->>'id')::uuid,
    strength.block_id,
    strength.user_id,
    strength.week_index,
    strength.day_index,
    (source.row->>'slot')::session_slot,
    (source.row->>'plannedAt')::timestamptz,
    source.row->>'title',
    source.row->>'role',
    source.row->'prescription',
    (source.row->>'completedSessionId')::uuid,
    (source.row->>'skippedAt')::timestamptz,
    source.row->>'sessionModality',
    (source.row->>'effectiveStressLoad')::numeric,
    source.row->>'notes',
    (source.row->>'createdAt')::timestamptz
  FROM public.planned_sessions AS strength
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(
      NULLIF(
        strength.prescription#>'{meta,embeddedRehabMigrationSources}',
        '[]'::jsonb
      ),
      strength.prescription#>'{meta,embeddedRehabSections}',
      '[]'::jsonb
    )
  ) AS section(value)
  CROSS JOIN LATERAL (
    SELECT section.value#>'{migrationSource,originalRehabRow}' AS row
  ) AS source
  WHERE section.value#>>'{migrationSource,migration}' =
    '0127_embed_same_day_rehab'
    AND NOT EXISTS (
      SELECT 1
      FROM public.planned_sessions AS existing
      WHERE existing.id = (source.row->>'id')::uuid
    );

  WITH restorations AS (
    SELECT DISTINCT ON (strength.id)
      strength.id,
      section.value#>'{migrationSource,originalStrengthPrescription}'
        AS prescription
    FROM public.planned_sessions AS strength
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(
        NULLIF(
          strength.prescription#>'{meta,embeddedRehabMigrationSources}',
          '[]'::jsonb
        ),
        strength.prescription#>'{meta,embeddedRehabSections}',
        '[]'::jsonb
      )
    ) AS section(value)
    WHERE section.value#>>'{migrationSource,migration}' =
      '0127_embed_same_day_rehab'
    ORDER BY strength.id
  )
  UPDATE public.planned_sessions AS strength
  SET prescription = restorations.prescription
  FROM restorations
  WHERE strength.id = restorations.id;
END $$;

DROP FUNCTION IF EXISTS public.rewrite_planned_sessions_atomically(
  uuid,
  jsonb,
  jsonb,
  jsonb
);

CREATE OR REPLACE FUNCTION public.complete_training_session(
  p_session_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH metrics AS (
    SELECT
      ROUND(
        SUM(sl.rpe * sl.weight_kg * sl.reps)
          FILTER (
            WHERE sl.rpe IS NOT NULL
              AND sl.weight_kg IS NOT NULL
              AND sl.reps IS NOT NULL
              AND sl.weight_kg > 0
              AND sl.reps > 0
          )
        /
        NULLIF(
          SUM(sl.weight_kg * sl.reps)
            FILTER (
              WHERE sl.rpe IS NOT NULL
                AND sl.weight_kg IS NOT NULL
                AND sl.reps IS NOT NULL
                AND sl.weight_kg > 0
                AND sl.reps > 0
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
                  EPOCH FROM (MAX(sl.created_at) - MIN(sl.created_at))
                ) / 60
              )::integer
            ),
            0
          )
        ELSE NULL
      END AS duration_min
    FROM public.set_logs sl
    WHERE sl.session_id = p_session_id
      AND sl.skipped = false
  ),
  updated AS (
    UPDATE public.sessions s
       SET session_rpe = metrics.session_rpe,
           duration_min = metrics.duration_min,
           notes = p_notes,
           completed_at = now()
      FROM metrics
     WHERE s.id = p_session_id
       AND s.user_id = (SELECT auth.uid())
    RETURNING s.user_id
  )
  SELECT user_id FROM updated;
$$;

GRANT EXECUTE ON FUNCTION public.complete_training_session(uuid, text)
  TO authenticated;
