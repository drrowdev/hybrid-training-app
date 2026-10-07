import { SEED_MOVEMENTS } from "../../../packages/db/seeds/movements";
import { MOVEMENT_INSTRUCTIONS } from "../../../packages/db/seeds/movement-instructions";
import { acceptanceAssert as assert } from "./swim-acceptance-errors";

export const BAND_PRESSDOWN_FILES = {
  up: "packages/db/drizzle/0163_seed_band_triceps_pressdown.sql",
  down: "packages/db/rollbacks/0163_seed_band_triceps_pressdown.down.sql",
} as const;

const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

export function bandPressdownRehearsalSql(up: string, down: string) {
  const movement = SEED_MOVEMENTS.find((m) => m.slug === "band-triceps-pressdown");
  const instruction = MOVEMENT_INSTRUCTIONS.find((m) => m.slug === movement?.slug);
  assert(movement && instruction, "Band pressdown seed missing");
  const expected = {
    bulletproof_roles: [], functional_roles: [], is_supported: false,
    eccentric_load_score: null, stim_to_fatigue_score: null,
    ...Object.fromEntries(Object.entries(movement).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value,
    ])),
  };
  const howTo = {
    summary: instruction.summary, setup: instruction.setup, steps: instruction.steps,
    cues: instruction.cues, common_mistakes: instruction.commonMistakes,
    source: "seed-v1", reviewed: false,
  };
  // Embed the exact down body in this rollback-only transaction.
  assert(down.includes("\nBEGIN;") && down.endsWith("COMMIT;\n"), "Unexpected catalog down boundary");
  const downBody = down.replace("\nBEGIN;", "\n").replace(/COMMIT;\n$/, "");
  const parity = `
    IF (SELECT count(*) FROM public.movements WHERE user_id IS NULL AND slug = 'band-triceps-pressdown') <> 1
      OR NOT EXISTS (SELECT 1 FROM public.movements m
        WHERE m.user_id IS NULL AND m.slug = 'band-triceps-pressdown'
          AND to_jsonb(m) - ARRAY['id', 'created_at'] = ${literal(expected)})
      OR NOT EXISTS (SELECT 1 FROM public.movement_instructions i JOIN public.movements m ON m.id = i.movement_id
        WHERE m.user_id IS NULL AND m.slug = 'band-triceps-pressdown'
          AND to_jsonb(i) - ARRAY['movement_id', 'updated_at'] = ${literal(howTo)})
    THEN RAISE EXCEPTION 'Catalog/seed parity failed'; END IF;`;
  const refuses = `
    BEGIN
      EXECUTE $down$${downBody}$down$;
      RAISE EXCEPTION 'Used catalog down unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
    END;`;
  return `BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE band_catalog_before ON COMMIT DROP AS
  SELECT id, to_jsonb(m) AS value FROM public.movements m;
CREATE TEMP TABLE band_instructions_before ON COMMIT DROP AS
  SELECT movement_id, to_jsonb(i) AS value FROM public.movement_instructions i;
DO $probe$
DECLARE
  movement uuid;
  actor uuid := gen_random_uuid();
  session uuid := gen_random_uuid();
BEGIN
  ${parity}
  EXECUTE $up$${up}$up$;
  EXECUTE $up$${up}$up$;
  IF EXISTS (SELECT 1 FROM band_catalog_before b FULL JOIN public.movements m USING (id)
    WHERE b.value IS DISTINCT FROM to_jsonb(m))
    OR EXISTS (SELECT 1 FROM band_instructions_before b FULL JOIN public.movement_instructions i USING (movement_id)
    WHERE b.value IS DISTINCT FROM to_jsonb(i))
  THEN RAISE EXCEPTION 'Catalog replay changed existing rows'; END IF;

  EXECUTE $down$${downBody}$down$;
  IF EXISTS (SELECT 1 FROM public.movements WHERE user_id IS NULL AND slug = 'band-triceps-pressdown')
  THEN RAISE EXCEPTION 'Unused down did not remove movement'; END IF;
  EXECUTE $up$${up}$up$;
  ${parity}
  SELECT id INTO STRICT movement FROM public.movements WHERE user_id IS NULL AND slug = 'band-triceps-pressdown';
  IF EXISTS (SELECT 1 FROM band_catalog_before b
    WHERE b.value->>'slug' <> 'band-triceps-pressdown'
      AND NOT EXISTS (SELECT 1 FROM public.movements m WHERE m.id = b.id AND to_jsonb(m) = b.value))
    OR EXISTS (SELECT 1 FROM band_instructions_before b
      WHERE b.movement_id <> (SELECT id FROM band_catalog_before WHERE value->>'slug' = 'band-triceps-pressdown')
      AND NOT EXISTS (SELECT 1 FROM public.movement_instructions i
        WHERE i.movement_id = b.movement_id AND to_jsonb(i) = b.value))
  THEN RAISE EXCEPTION 'Roundtrip changed other catalog entries'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.movements
    WHERE id = movement AND display_name ILIKE '%band%' AND display_name ILIKE '%pressdown%'
      AND slug ILIKE '%band%' AND slug ILIKE '%pressdown%')
  THEN RAISE EXCEPTION 'Search terms do not find movement'; END IF;

  INSERT INTO auth.users (id, raw_app_meta_data, raw_user_meta_data) VALUES (actor, '{}', '{}');
  INSERT INTO public.sessions (id, user_id, title, slot, prescription)
    VALUES (session, actor, 'Synthetic band workout', 'single',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('movementSlug', 'band-triceps-pressdown'))));
  ${refuses}
  UPDATE public.sessions SET prescription = jsonb_build_object('items',
    jsonb_build_array(jsonb_build_object('movementId', movement))) WHERE id = session;
  ${refuses}
  UPDATE public.sessions SET prescription = NULL WHERE id = session;
  INSERT INTO public.session_movements (session_id, movement_id, user_id, sort_order)
    VALUES (session, movement, actor, 0);
  ${refuses}
  DELETE FROM public.session_movements WHERE session_id = session;
  INSERT INTO public.set_logs (session_id, movement_id, set_index, reps, weight_kg, rpe, set_kind)
    VALUES (session, movement, 1, 15, 0, 8, 'accessory');
  ${refuses}
  IF NOT EXISTS (SELECT 1 FROM public.set_logs
    WHERE session_id = session AND movement_id = movement AND reps = 15 AND weight_kg = 0 AND rpe = 8)
  THEN RAISE EXCEPTION 'Band set was not retained'; END IF;
END $probe$;
ROLLBACK;`;
}
