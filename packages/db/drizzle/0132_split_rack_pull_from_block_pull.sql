-- Split Rack Pull out of Block Pull Deadlift.
--
-- Background: the catalog never had a Rack Pull row. The platform faked one by
-- pointing the engine key `rack-pull` at the `block-pull-deadlift` row with a
-- display-name override (see apps/web/src/lib/platform/movement-keys.ts). Two
-- consequences:
--
--   1. A 1RM entered under "Rack Pull" was stored against Block Pull Deadlift.
--      Because that slug is ALSO a Deadlift-role candidate
--      (STRENGTH_ROLE_CANDIDATES.deadlift), the lifter's Deadlift row on the
--      1-rep-maxes screen then re-anchored to "Block Pull Deadlift".
--   2. A genuine Block Pull Deadlift max was read back by the engine as the
--      rack-pull anchor.
--
-- They are different movements (rack pins vs blocks; different range and loads),
-- so they get separate catalog rows.
--
-- Data decision (owner-confirmed): every existing reference to the shared row —
-- training maxes, TM history/suggestions, logged sets, session movements and
-- planned prescriptions, including logged history — moves to Rack Pull. This is
-- done by RENAMING the existing row in place, which keeps its UUID and therefore
-- carries every foreign-key reference across atomically, and then inserting a
-- fresh, empty Block Pull Deadlift row. Only the denormalised slug/name copies
-- inside prescription JSONB need rewriting.
--
-- Idempotent: the one-time data move is guarded on the absence of a global
-- `rack-pull` row; the canonical definitions below are plain upserts.

-- ── Part 1 — one-time data move ─────────────────────────────────────────────
DO $$
DECLARE
  moved_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.movements WHERE user_id IS NULL AND slug = 'rack-pull'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.movements
     SET slug = 'rack-pull'
   WHERE user_id IS NULL
     AND slug = 'block-pull-deadlift'
  RETURNING id INTO moved_id;

  -- Fresh database with no block-pull row yet: nothing to carry over, Part 2
  -- creates both movements from scratch.
  IF moved_id IS NULL THEN
    RETURN;
  END IF;

  -- Prescriptions embed a movementSlug / movementName copy alongside the id, so
  -- the renamed row would still render as "Block Pull Deadlift" without this.
  UPDATE public.planned_sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = moved_id::text
                          THEN item || jsonb_build_object(
                                 'movementSlug', 'rack-pull',
                                 'movementName', 'Rack Pull'
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
           jsonb_build_object('movementId', moved_id::text)
         );

  UPDATE public.sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = moved_id::text
                          THEN item || jsonb_build_object(
                                 'movementSlug', 'rack-pull',
                                 'movementName', 'Rack Pull'
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
           jsonb_build_object('movementId', moved_id::text)
         );
END $$;

-- ── Part 2 — canonical definitions (idempotent) ─────────────────────────────
-- Mirrors the `hinge(...)` seed helper in packages/db/seeds/movements-part1.ts.

INSERT INTO public.movements (
  user_id, slug, display_name, pattern, primary_region, secondary_regions,
  primary_muscles, secondary_muscles, equipment, is_compound, interference_cost,
  high_strain_tendon, bulletproof_roles, functional_roles, is_supported,
  axial_load, stability, bilateral, body_weight_loaded,
  experience_min, experience_max, metadata
) VALUES
  (
    NULL, 'rack-pull', 'Rack Pull', 'hinge', 'hamstring_posterior',
    '["lumbar_trunk","knee"]'::jsonb,
    '{"hamstrings","glutes","lower_back"}'::muscle[],
    '{"lats","forearms","traps"}'::muscle[],
    'barbell-rack', true, 'low', false,
    '{}'::text[], '{"compound_assistance"}'::text[], false,
    'high', 'free', true, false, 2, 4,
    '{"emphasis":"lockout-strength","rom_profile":"partial"}'::jsonb
  ),
  (
    NULL, 'block-pull-deadlift', 'Block Pull Deadlift', 'hinge', 'hamstring_posterior',
    '["lumbar_trunk","knee"]'::jsonb,
    '{"hamstrings","glutes","lower_back"}'::muscle[],
    '{"lats","forearms","traps"}'::muscle[],
    'barbell-blocks', true, 'low', false,
    '{}'::text[], '{"compound_assistance"}'::text[], false,
    'high', 'free', true, false, 2, 4,
    '{"emphasis":"lockout-strength"}'::jsonb
  )
ON CONFLICT (user_id, slug) DO UPDATE SET
  display_name = excluded.display_name,
  pattern = excluded.pattern,
  primary_region = excluded.primary_region,
  secondary_regions = excluded.secondary_regions,
  primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles,
  equipment = excluded.equipment,
  is_compound = excluded.is_compound,
  interference_cost = excluded.interference_cost,
  high_strain_tendon = excluded.high_strain_tendon,
  bulletproof_roles = excluded.bulletproof_roles,
  functional_roles = excluded.functional_roles,
  is_supported = excluded.is_supported,
  axial_load = excluded.axial_load,
  stability = excluded.stability,
  bilateral = excluded.bilateral,
  body_weight_loaded = excluded.body_weight_loaded,
  experience_min = excluded.experience_min,
  experience_max = excluded.experience_max,
  metadata = excluded.metadata;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  id,
  'Deadlift from rack pins (bar raised) to overload the lockout and top half.',
  'Set the pins so the bar starts at or just above the knee; set up as a normal deadlift.',
  '["Brace and take the slack out of the bar.","Push the floor away and drive the hips through to lockout.","Lower to the pins under control."]'::jsonb,
  '["Bar stays close to the legs.","Finish with locked hips and knees."]'::jsonb,
  '["Bouncing the bar off the pins to start the next rep."]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'rack-pull'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;

INSERT INTO public.movement_instructions (
  movement_id, summary, setup, steps, cues, common_mistakes, source, reviewed, updated_at
)
SELECT
  id,
  'Deadlift from blocks (bar raised) to overload the lockout and top half.',
  'Set the bar on blocks at/just below the knee; set up as a normal deadlift.',
  '["Brace and take the slack out.","Push the floor away and drive the hips through to lockout.","Lower to the blocks under control."]'::jsonb,
  '["Bar stays close to the legs.","Finish with locked hips and knees."]'::jsonb,
  '[]'::jsonb,
  'seed-v1',
  false,
  now()
FROM public.movements
WHERE user_id IS NULL AND slug = 'block-pull-deadlift'
ON CONFLICT (movement_id) DO UPDATE SET
  summary = excluded.summary,
  setup = excluded.setup,
  steps = excluded.steps,
  cues = excluded.cues,
  common_mistakes = excluded.common_mistakes,
  source = excluded.source,
  reviewed = excluded.reviewed,
  updated_at = excluded.updated_at;
