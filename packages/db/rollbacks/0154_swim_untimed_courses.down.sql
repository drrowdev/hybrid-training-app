BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.swim_plans, public.swim_workouts IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.swim_plans WHERE definition->'setup'->'sessionBudgetMinutes' = 'null'::jsonb)
     OR EXISTS (SELECT 1 FROM public.swim_workouts WHERE jsonb_path_exists(definition, '$.**.budget.minutes ? (@ == null)')) THEN
    RAISE EXCEPTION 'Cannot remove untimed swimming support while retained plans or prescriptions use it.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swim_validate_prescription(p_workout jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_section jsonb; v_item jsonb; v_total bigint := 0; v_rounds bigint;
  v_order integer := 0; v_next integer; v_kinds text[] := ARRAY[]::text[];
  v_strokes text[] := ARRAY[]::text[]; v_equipment text[] := ARRAY[]::text[];
BEGIN
  IF p_workout->>'kind' IS DISTINCT FROM 'swim_workout'
     OR p_workout->>'focus' IS NULL
     OR p_workout->>'focus' NOT IN ('technique_base','endurance','event_specific')
     OR jsonb_typeof(p_workout->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_workout->'sections') NOT BETWEEN 3 AND 20 THEN
    RAISE EXCEPTION 'Invalid swimming prescription.';
  END IF;
  PERFORM public.swim_validate_snapshot(p_workout->'snapshot');
  PERFORM public.swim_bounded_integer(p_workout->'budget'->'minutes', 1, 240);
  PERFORM public.swim_bounded_integer(p_workout->'budget'->'accountedMs', 0, 86400000);
  IF NOT (p_workout ? 'estimatedMs') THEN RAISE EXCEPTION 'Invalid swimming budget.'; END IF;
  IF p_workout->'estimatedMs' <> 'null'::jsonb THEN
    PERFORM public.swim_bounded_integer(p_workout->'estimatedMs', 1, 86400000);
    IF p_workout->'snapshot'->'calibration' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Uncalibrated swimming cannot claim an estimated duration.';
    END IF;
    IF p_workout->'estimatedMs' IS DISTINCT FROM p_workout->'budget'->'accountedMs' THEN
      RAISE EXCEPTION 'Swimming duration must match its timed work.';
    END IF;
  END IF;
  FOR v_section IN SELECT value FROM jsonb_array_elements(p_workout->'sections') LOOP
    v_next := array_position(ARRAY['warmup','preparation','main','recovery','cooldown'], v_section->>'kind');
    IF v_next IS NULL OR v_next < v_order
       OR jsonb_typeof(v_section->'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_section->'items') NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'Invalid swimming sections.';
    END IF;
    v_order := v_next; v_kinds := array_append(v_kinds, v_section->>'kind');
    v_rounds := public.swim_bounded_integer(v_section->'rounds', 1, 2000);
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_section->'items') LOOP
      v_total := v_total + v_rounds
        * public.swim_bounded_integer(v_item->'repeats', 1, 2000)
        * public.swim_bounded_integer(v_item->'lengths', 1, 2000);
      IF v_total > 2000 THEN RAISE EXCEPTION 'Swimming prescription exceeds its length limit.'; END IF;
      PERFORM public.swim_validate_labels(jsonb_build_array(v_item->'stroke'),
        ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
      PERFORM public.swim_validate_labels(v_item->'equipment',
        ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
      v_strokes := array_append(v_strokes, v_item->>'stroke');
      v_equipment := v_equipment || ARRAY(SELECT jsonb_array_elements_text(v_item->'equipment'));
      IF v_item->>'effort' IS NULL OR v_item->>'effort' NOT IN ('easy','steady','brisk','threshold','sprint')
         OR jsonb_typeof(v_item->'optional') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Invalid swimming effort.';
      END IF;
      IF v_item ? 'targetMsPerRepeat' THEN
        PERFORM public.swim_bounded_integer(v_item->'targetMsPerRepeat', 1, 86400000);
        IF p_workout->'snapshot'->'calibration' = 'null'::jsonb THEN
          RAISE EXCEPTION 'Swimming pace targets require a calibration.';
        END IF;
      END IF;
      IF v_item ? 'sendoffMs' THEN PERFORM public.swim_bounded_integer(v_item->'sendoffMs', 1, 86400000); END IF;
      IF v_item ? 'restSeconds' THEN PERFORM public.swim_bounded_integer(v_item->'restSeconds', 0, 86400); END IF;
    END LOOP;
  END LOOP;
  IF NOT (v_kinds @> ARRAY['warmup','main','cooldown'])
     OR v_total <> public.swim_bounded_integer(p_workout->'totalLengths', 1, 2000)
     OR (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(v_strokes) s)
        IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM jsonb_array_elements_text(p_workout->'snapshot'->'strokes') s)
     OR (SELECT array_agg(DISTINCT s ORDER BY s) FROM unnest(v_equipment) s)
        IS DISTINCT FROM (SELECT array_agg(s ORDER BY s) FROM jsonb_array_elements_text(p_workout->'snapshot'->'equipment') s) THEN
    RAISE EXCEPTION 'Swimming totals or snapshot categories disagree with the prescription.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swim_validate_plan(p_definition jsonb, p_state jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE v_entry jsonb; v_setup jsonb := p_definition->'setup'; v_cal jsonb := p_state->'acceptedCalibration';
BEGIN
  IF p_definition->'version' IS DISTINCT FROM '1'::jsonb
     OR p_state->'version' IS DISTINCT FROM '1'::jsonb
     OR NULLIF(p_definition->>'generatorVersion', '') IS NULL
     OR jsonb_typeof(p_state->'observations') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_state->'decisions') IS DISTINCT FROM 'array'
     OR NOT (p_state ? 'acceptedCalibration') THEN
    RAISE EXCEPTION 'Invalid swimming plan or state version.';
  END IF;
  PERFORM public.swim_validate_course(v_setup->'course');
  PERFORM public.swim_validate_labels(v_setup->'knownStrokes',
    ARRAY['freestyle','backstroke','breaststroke','butterfly','individual_medley','choice','kick'], true);
  PERFORM public.swim_validate_labels(v_setup->'equipment',
    ARRAY['kickboard','pull_buoy','fins','paddles','snorkel'], false);
  PERFORM public.swim_bounded_integer(v_setup->'recentComfortableLengths', 1, 2000);
  PERFORM public.swim_bounded_integer(v_setup->'sessionBudgetMinutes', 10, 240);
  IF v_setup->>'goal' IS NULL OR v_setup->>'goal' NOT IN ('technique_base','endurance')
     OR v_setup->>'experience' IS NULL
     OR v_setup->>'experience' NOT IN ('learning','returning','recreational','trained') THEN
    RAISE EXCEPTION 'Invalid swimming setup.';
  END IF;
  IF v_setup ? 'event' THEN
    IF jsonb_typeof(v_setup->'event'->'distance') IS DISTINCT FROM 'number'
       OR (v_setup->'event'->>'distance')::numeric <= 0
       OR (v_setup->'event'->>'distance')::numeric > 200000
       OR v_setup->'event'->>'unit' IS NULL OR v_setup->'event'->>'unit' NOT IN ('m','yd')
       OR NULLIF(v_setup->'event'->>'dateISO', '') IS NULL THEN RAISE EXCEPTION 'Invalid swimming event.'; END IF;
    PERFORM (v_setup->'event'->>'dateISO')::date;
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_state->'observations') LOOP
    PERFORM public.swim_validate_observation(v_entry);
  END LOOP;
  IF v_setup ? 'benchmarks' THEN
    IF jsonb_typeof(v_setup->'benchmarks') <> 'array' THEN RAISE EXCEPTION 'Invalid swimming benchmarks.'; END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_setup->'benchmarks') LOOP
      PERFORM public.swim_validate_observation(v_entry);
    END LOOP;
  END IF;
  IF v_cal <> 'null'::jsonb THEN
    PERFORM public.swim_validate_verified_calibration(v_cal);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'observations') WHERE value = v_cal->'observation')
       OR v_cal->'course' IS DISTINCT FROM v_cal->'observation'->'course'
       OR v_cal->'stroke' IS DISTINCT FROM v_cal->'observation'->'stroke'
       OR v_cal->'equipment' IS DISTINCT FROM v_cal->'observation'->'equipment'
       OR v_cal->'protocol' IS DISTINCT FROM v_cal->'observation'->'protocol'
       OR v_cal->>'unit' IS DISTINCT FROM v_cal->'course'->>'unit'
       OR v_cal->'heuristic' IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_cal->'msPer100') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Swimming calibration must retain its original observation.';
    END IF;
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_state->'decisions') LOOP
    IF NULLIF(v_entry->>'id', '') IS NULL OR NULLIF(v_entry->>'recordedAt', '') IS NULL
       OR NULLIF(v_entry->>'ruleVersion', '') IS NULL OR NULLIF(v_entry->>'generatorVersion', '') IS NULL
       OR v_entry->>'kind' IS NULL OR v_entry->>'kind' NOT IN ('progression','assessment','schedule','setup')
       OR v_entry->>'decision' IS NULL OR v_entry->>'decision' NOT IN ('accepted','rejected','overridden')
       OR jsonb_typeof(v_entry->'inputSnapshot') IS DISTINCT FROM 'object'
       OR (v_entry->>'decision' = 'overridden' AND NULLIF(btrim(v_entry->>'reason'), '') IS NULL) THEN
      RAISE EXCEPTION 'Swimming decisions require their input snapshot, versions and override reason.';
    END IF;
    PERFORM (v_entry->>'recordedAt')::timestamptz;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_state->'decisions')) THEN
    RAISE EXCEPTION 'Swimming decision IDs must be unique.';
  END IF;
END $$;

DROP FUNCTION public.swim_untimed_course_ready();
COMMIT;
