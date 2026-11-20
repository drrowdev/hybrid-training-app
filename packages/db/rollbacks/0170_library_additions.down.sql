-- Manual, unused-only rollback. Run in a maintenance window: locks prevent
-- new UUID/slug references appearing between the check and catalog deletion.
-- Check all public tables, including JSON prescriptions and historical snapshots,
-- not just movement_id FKs (some references cascade or have no FK).
-- Refusal means repair forward; never remove history to make this down succeed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';
DO $$
DECLARE
  slugs text[] := ARRAY[
      'push-up-incline',
      'push-up-decline',
      'push-up-neutral-grip',
      'push-up-deficit',
      'push-up-neutral-grip-deficit',
      'push-up-diamond',
      'push-up-archer',
      'push-up-hand-release',
      'push-up-weighted',
      'push-up-ring',
      'push-up-pike',
      'handstand-push-up',
      'push-up-clap',
      'scapular-push-up',
      'push-up-plus',
      'wall-slide',
      'machine-shoulder-press',
      'db-bench-neutral',
      'db-bench-incline-neutral',
      'db-bench-single-arm',
      'db-floor-press',
      'cable-chest-press-standing',
      'cable-chest-press-seated',
      'machine-chest-press-incline',
      'kb-press',
      'kb-press-bottoms-up',
      'spoto-press',
      'pin-press-bench',
      'board-press',
      'pull-up-wide',
      'pull-up-ring',
      'pull-up-assisted-machine',
      'pull-up-band-assisted',
      'lat-pulldown-wide-overhand',
      'lat-pulldown-underhand',
      'machine-high-row',
      'cable-row-single-arm',
      'cable-row-rope',
      'smith-row',
      't-bar-row-chest-supported',
      'towel-hang',
      'fat-grip-dead-hang',
      'reverse-curl-ez',
      'hammer-curl-cross-body',
      'zottman-curl',
      'cable-curl-bayesian',
      'cable-curl-bar',
      'preacher-curl-machine',
      'pushdown-single-arm',
      'tri-ext-cross-body-db',
      'dip-machine',
      'lateral-raise-bent-over-db',
      'cable-rear-delt-fly',
      'lateral-raise-cable-behind-back',
      'cable-y-raise',
      'leg-press-single-leg',
      'hack-squat-reverse',
      'heel-elevated-goblet-squat',
      'step-up-lateral',
      'shrimp-squat',
      'thruster-bb',
      'thruster-db',
      'overhead-squat',
      'kb-deadlift',
      'rdl-trap-bar',
      'hip-thrust-machine',
      'hip-thrust-db',
      'glute-ham-raise',
      'snatch-grip-deadlift',
      'calf-raise-leg-press',
      'calf-raise-smith',
      'calf-raise-donkey',
      'peroneal-raise-band',
      'cable-hip-adduction',
      'terminal-knee-extension-band',
      'adductor-squeeze-ball',
      'bridge-walkout',
      'clean',
      'snatch',
      'clean-and-jerk',
      'clean-and-press',
      'db-hang-clean',
      'kb-clean',
      'kb-swing-single-arm',
      'turkish-get-up',
      'kb-windmill',
      'carry-sandbag',
      'carry-bear-hug-sandbag',
      'carry-front-rack',
      'crunch-floor',
      'sit-up',
      'v-up',
      'russian-twist',
      'cable-woodchop',
      'landmine-rotation',
      'l-sit',
      'mountain-climber',
      'bear-crawl',
      'lying-leg-raise',
      'side-bend-db',
      'windshield-wiper-hanging',
      'mcgill-curl-up',
      'neck-flexion',
      'neck-extension',
      'assault-bike-intervals',
      'assault-bike-z2',
      'walk-incline-treadmill',
      'walk-easy',
      'hike',
      'run-z2-trail',
      'run-vo2-treadmill-intervals',
      'bike-sweet-spot',
      'ski-erg-intervals',
      'battle-ropes',
      'burpee'
  ];
  ids uuid[];
  pattern text;
  entry record;
  referenced boolean;
BEGIN
  FOR entry IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', entry.relname);
  END LOOP;

  SELECT coalesce(array_agg(id), '{}') INTO ids FROM public.movements
  WHERE user_id IS NULL AND slug = ANY (slugs);
  IF cardinality(ids) = 0 THEN RETURN; END IF;

  SELECT '(^|[^a-z0-9-])(' || string_agg(v, '|') || ')([^a-z0-9-]|$)' INTO pattern
  FROM (
    SELECT unnest(slugs) AS v
    UNION ALL
    SELECT unnest(ids)::text
  ) tokens;

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
        ($1 <> ''movements'' OR NOT ((to_jsonb(t)->>''id'') = ANY ($3)))
        AND to_jsonb(t)::text ~ $2)',
      entry.relname
    ) INTO referenced USING entry.relname, pattern, ids::text[];
    IF referenced THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'Refusing 0170 rollback: a movement added by this migration is referenced. Repair forward.';
    END IF;
  END LOOP;

  DELETE FROM public.movement_instructions WHERE movement_id = ANY (ids);
  DELETE FROM public.movements WHERE id = ANY (ids) AND user_id IS NULL;

  UPDATE public.movements
  SET pattern = 'isolation',
      secondary_regions = '["elbow_forearm"]'::jsonb,
      secondary_muscles = '{front_delts}'::public.muscle[],
      functional_roles = array_remove(functional_roles, 'compound_assistance')
  WHERE user_id IS NULL AND slug = 'push-up';
END $$;
COMMIT;
