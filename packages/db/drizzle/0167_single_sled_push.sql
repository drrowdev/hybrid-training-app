-- Sled Push is one exercise. The library carried it twice ("Sled Push — Light" and
-- "Sled Push — Heavy"); the heavy row stays and is renamed "Sled Push".
--
-- The slug sled-push-heavy is kept: the HYROX station mapping and logged history
-- reference it. Anything recorded against sled-push-light moves onto it, in the
-- same way 0138 merged the duplicate Copenhagen rows. The light row is deleted
-- only when nothing else in the schema still mentions it.
--
-- Idempotent: with the light row absent this only renames the survivor.
DO $$
DECLARE
  keep_id uuid;
  dup_id  uuid;
  entry   record;
  referenced boolean;
BEGIN
  SELECT id INTO keep_id FROM public.movements WHERE user_id IS NULL AND slug = 'sled-push-heavy';
  IF keep_id IS NULL THEN RETURN; END IF;
  SELECT id INTO dup_id FROM public.movements WHERE user_id IS NULL AND slug = 'sled-push-light';

  UPDATE public.movements SET display_name = 'Sled Push'
   WHERE id = keep_id AND display_name IS DISTINCT FROM 'Sled Push';

  -- Saved workouts carry a copy of the name; show the new one.
  UPDATE public.planned_sessions
     SET prescription = replace(prescription::text, 'Sled Push — Heavy', 'Sled Push')::jsonb
   WHERE prescription::text LIKE '%Sled Push — Heavy%';
  UPDATE public.sessions
     SET prescription = replace(prescription::text, 'Sled Push — Heavy', 'Sled Push')::jsonb
   WHERE prescription::text LIKE '%Sled Push — Heavy%';

  IF dup_id IS NULL THEN RETURN; END IF;

  UPDATE public.set_logs SET movement_id = keep_id WHERE movement_id = dup_id;
  UPDATE public.cardio_logs SET movement_id = keep_id WHERE movement_id = dup_id;

  -- Composite PK (session_id, movement_id): drop the duplicate's row where the
  -- session already holds the survivor.
  DELETE FROM public.session_movements dup
   WHERE dup.movement_id = dup_id
     AND EXISTS (
       SELECT 1 FROM public.session_movements keep
        WHERE keep.session_id = dup.session_id AND keep.movement_id = keep_id
     );
  UPDATE public.session_movements SET movement_id = keep_id WHERE movement_id = dup_id;

  UPDATE public.planned_sessions
     SET prescription = replace(replace(replace(prescription::text,
           dup_id::text, keep_id::text),
           'sled-push-light', 'sled-push-heavy'),
           'Sled Push — Light', 'Sled Push')::jsonb
   WHERE prescription::text LIKE '%' || dup_id::text || '%'
      OR prescription::text LIKE '%sled-push-light%'
      OR prescription::text LIKE '%Sled Push — Light%';
  UPDATE public.sessions
     SET prescription = replace(replace(replace(prescription::text,
           dup_id::text, keep_id::text),
           'sled-push-light', 'sled-push-heavy'),
           'Sled Push — Light', 'Sled Push')::jsonb
   WHERE prescription::text LIKE '%' || dup_id::text || '%'
      OR prescription::text LIKE '%sled-push-light%'
      OR prescription::text LIKE '%Sled Push — Light%';

  -- Authored program definitions reference movements by id.
  UPDATE public.program_instances
     SET instance = replace(instance::text, dup_id::text, keep_id::text)::jsonb,
         setup_input = replace(setup_input::text, dup_id::text, keep_id::text)::jsonb
   WHERE instance::text LIKE '%' || dup_id::text || '%'
      OR setup_input::text LIKE '%' || dup_id::text || '%';

  FOR entry IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname <> 'movement_instructions'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I t WHERE
        ($1 <> ''movements'' OR to_jsonb(t)->>''id'' IS DISTINCT FROM $2)
        AND (strpos(to_jsonb(t)::text, $2) > 0
          OR strpos(to_jsonb(t)::text, ''sled-push-light'') > 0))',
      entry.relname
    ) INTO referenced USING entry.relname, dup_id::text;
    IF referenced THEN
      RAISE NOTICE '0167: sled-push-light is still referenced in %; keeping the row.', entry.relname;
      RETURN;
    END IF;
  END LOOP;

  DELETE FROM public.movements WHERE id = dup_id AND user_id IS NULL;
END $$;
