-- DC-K4: resume the retained schedule without changing workouts or program identity.
ALTER TABLE public.engine_override_events DROP CONSTRAINT engine_override_events_event_type_check;
ALTER TABLE public.engine_override_events ADD CONSTRAINT engine_override_events_event_type_check
  CHECK (event_type IN ('skip', 'swap', 'manual_end', 'manual_resume', 'custom'));

DO $migration$
DECLARE
  routine regprocedure := to_regprocedure('public.training_schedule_commit(text,jsonb,text,uuid,text,boolean)');
  body text; definition text; replacement text;
BEGIN
  SELECT prosrc, pg_get_functiondef(oid) INTO body, definition FROM pg_proc WHERE oid = routine;
  IF body IS NULL OR md5(replace(body, E'\r\n', E'\n')) <> '25a51e75f44b9ecbe08c7f37510c278b' THEN
    RAISE EXCEPTION 'Unexpected training schedule function; resume migration refused.';
  END IF;
  replacement := $resume$    -- 0162 primary-resume begin
    WHEN 'primary-resume' THEN
      SELECT * INTO block FROM public.training_blocks
        WHERE id = (p_args->>'id')::uuid AND user_id = u
          AND status = 'archived' AND deleted_at IS NULL AND ended_at IS NOT NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'This program cannot be resumed.' USING ERRCODE = '22023'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.planned_sessions p
        LEFT JOIN public.sessions s ON s.id = p.completed_session_id AND s.user_id = u
        WHERE p.block_id = block.id AND p.user_id = u AND p.skipped_at IS NULL
          AND p.role IS DISTINCT FROM 'rest' AND p.prescription->>'kind' IS DISTINCT FROM 'rest'
          AND (s.completed_at IS NULL OR s.deleted_at IS NOT NULL)
          AND block.started_on - (extract(isodow FROM block.started_on)::integer - 1) + p.week_index * 7 + p.day_index >=
            (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.profiles WHERE id = u), 'UTC'))::date
      ) THEN RAISE EXCEPTION 'This program has no workouts left.' USING ERRCODE = '22023'; END IF;
      SELECT to_jsonb(b) || jsonb_build_object('displayName',
        COALESCE((SELECT i.display_name FROM public.program_instances i
          WHERE i.block_id = b.id AND i.user_id = u AND i.deleted_at IS NULL LIMIT 1), NULLIF(b.notes, ''), 'the active program'))
        INTO entry FROM public.training_blocks b
        WHERE b.user_id = u AND b.id <> block.id AND b.status = 'active' AND b.deleted_at IS NULL
          AND (b.program_kind = block.program_kind OR b.program_kind IS NULL OR block.program_kind IS NULL)
        ORDER BY b.id LIMIT 1;
      IF FOUND THEN RAISE EXCEPTION 'End % first.', entry->>'displayName' USING ERRCODE = '23505'; END IF;
      UPDATE public.training_blocks SET status = 'active', archived_at = NULL, ended_at = NULL, updated_at = now()
        WHERE id = block.id AND user_id = u;
      UPDATE public.program_instances SET status = 'active', updated_at = now()
        WHERE block_id = block.id AND user_id = u AND deleted_at IS NULL;
      INSERT INTO public.engine_override_events(user_id,event_type,block_id,context)
        VALUES (u,'manual_resume',block.id,jsonb_build_object('archetype',block.archetype,'weeks',block.weeks));
      result := jsonb_build_object('id', block.id);
    -- 0162 primary-resume end
    WHEN 'primary-end' THEN$resume$;
  EXECUTE replace(definition, body, replace(body, '    WHEN ''primary-end'' THEN', replacement));
END $migration$;
