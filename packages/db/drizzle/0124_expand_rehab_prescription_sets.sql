-- Normalize rehab prescriptions to the logger's one-item-per-set contract.
-- Existing rows with logged sets are deliberately left untouched because their
-- prescription_item_index values already refer to the legacy item positions.
-- Idempotent: after expansion every item has sets=1.

UPDATE public.planned_sessions AS planned
SET prescription = jsonb_set(
  planned.prescription,
  '{items}',
  (
    SELECT jsonb_agg(
      jsonb_set(item.value, '{sets}', '1'::jsonb, true)
      ORDER BY item.ordinality, copies.copy_index
    )
    FROM jsonb_array_elements(planned.prescription->'items')
      WITH ORDINALITY AS item(value, ordinality)
    CROSS JOIN LATERAL generate_series(
      1,
      GREATEST(
        1,
        CASE
          WHEN jsonb_typeof(item.value->'sets') = 'number'
            THEN (item.value->>'sets')::integer
          ELSE 1
        END
      )
    ) AS copies(copy_index)
  ),
  false
)
WHERE planned.role = 'rehab'
  AND jsonb_typeof(planned.prescription->'items') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(planned.prescription->'items') AS item(value)
    WHERE jsonb_typeof(item.value->'sets') = 'number'
      AND (item.value->>'sets')::integer > 1
  )
  AND (
    planned.completed_session_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.set_logs
      WHERE set_logs.session_id = planned.completed_session_id
    )
  );
