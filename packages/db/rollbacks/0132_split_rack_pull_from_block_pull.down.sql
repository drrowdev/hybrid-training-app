-- Rollback for 0132_split_rack_pull_from_block_pull.
--
-- Re-merges the two rows by deleting the Block Pull Deadlift row created by the
-- forward migration and renaming Rack Pull back to `block-pull-deadlift`, which
-- returns every training max / logged set / prescription reference to where it
-- was before 0132 ran.
--
-- WARNING — destructive for post-0132 data: `movements` cascades on delete, so
-- any training max, TM history/suggestion row or session movement recorded
-- against the NEW Block Pull Deadlift row after 0132 is dropped. Logged sets and
-- prescriptions referencing it will point at a movement that no longer exists.
-- Check for such rows before running this.

DO $$
DECLARE
  merged_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.movements WHERE user_id IS NULL AND slug = 'rack-pull'
  ) THEN
    RETURN;
  END IF;

  DELETE FROM public.movements
   WHERE user_id IS NULL AND slug = 'block-pull-deadlift';

  UPDATE public.movements
     SET slug = 'block-pull-deadlift',
         display_name = 'Block Pull Deadlift',
         equipment = 'barbell-blocks',
         metadata = '{"emphasis":"lockout-strength"}'::jsonb
   WHERE user_id IS NULL
     AND slug = 'rack-pull'
  RETURNING id INTO merged_id;

  IF merged_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.movement_instructions
     SET summary = 'Deadlift from blocks (bar raised) to overload the lockout and top half.',
         setup = 'Set the bar on blocks at/just below the knee; set up as a normal deadlift.',
         steps = '["Brace and take the slack out.","Push the floor away and drive the hips through to lockout.","Lower to the blocks under control."]'::jsonb,
         cues = '["Bar stays close to the legs.","Finish with locked hips and knees."]'::jsonb,
         common_mistakes = '[]'::jsonb,
         updated_at = now()
   WHERE movement_id = merged_id;

  UPDATE public.planned_sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = merged_id::text
                          THEN item || jsonb_build_object(
                                 'movementSlug', 'block-pull-deadlift',
                                 'movementName', 'Block Pull Deadlift'
                               )
                        ELSE item
                      END
                      ORDER BY ord
                    )
             FROM jsonb_array_elements(prescription->'items') WITH ORDINALITY AS t(item, ord)
           )
         )
   WHERE jsonb_typeof(prescription->'items') = 'array'
     AND prescription->'items' @> jsonb_build_array(
           jsonb_build_object('movementId', merged_id::text)
         );

  UPDATE public.sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = merged_id::text
                          THEN item || jsonb_build_object(
                                 'movementSlug', 'block-pull-deadlift',
                                 'movementName', 'Block Pull Deadlift'
                               )
                        ELSE item
                      END
                      ORDER BY ord
                    )
             FROM jsonb_array_elements(prescription->'items') WITH ORDINALITY AS t(item, ord)
           )
         )
   WHERE jsonb_typeof(prescription->'items') = 'array'
     AND prescription->'items' @> jsonb_build_array(
           jsonb_build_object('movementId', merged_id::text)
         );
END $$;
