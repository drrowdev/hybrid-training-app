-- Merge the duplicate Copenhagen catalog rows.
--
-- The catalog carried the same exercise twice: `copenhagen-plank` (seeded by
-- the `legIso(...)` helper, pattern `isolation`) and `copenhagen-side-plank`
-- (seeded by the `tendon(...)` helper, pattern `tendon`). Identical setup,
-- steps, cues, region, equipment and — because `derive-roles.ts` keys off
-- metadata.protocol and a /copenhagen/ slug match — identical
-- `bulletproof_roles` + `functional_roles`. Two library entries, one exercise.
--
-- The ISOLATION row survives. `apps/web/src/lib/platform/tb-accessories.ts`
-- hard-filters `pattern = 'isolation'`, so the tendon copy could never be
-- picked as accessory work, and nothing anywhere selects candidates by
-- `pattern = 'tendon'` (the prescription item kind `tendon` is a separate
-- concept). The survivor keeps its `experience_min = 2` and its
-- `high_strain_tendon = false`: an adductor hold is not high-strain tendon
-- loading in the Baar sense, and flipping the flag would change DC-J5
-- refractory gating for the whole adductor_groin region.
--
-- Data decision (owner-confirmed): any history recorded against the duplicate
-- MOVES onto the survivor rather than being dropped. This matters — `set_logs`
-- and `session_movements` reference `movements(id)` ON DELETE RESTRICT (see
-- 0003 and 0059), so a bare DELETE would either fail outright or, where only
-- the CASCADE references exist (`training_maxes`, `tm_suggestions`,
-- `movement_instructions`), silently destroy a training max.
--
-- Idempotent, and safe in every ordering:
--   * duplicate absent                → no-op.
--   * duplicate present, survivor not → rename the duplicate in place, which
--                                       carries every reference across on its
--                                       existing UUID.
--   * both present                    → repoint, then delete the duplicate.

DO $$
DECLARE
  dup_id  uuid;
  keep_id uuid;
BEGIN
  SELECT id INTO dup_id
    FROM public.movements
   WHERE user_id IS NULL AND slug = 'copenhagen-side-plank';

  IF dup_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO keep_id
    FROM public.movements
   WHERE user_id IS NULL AND slug = 'copenhagen-plank';

  -- Survivor not seeded yet: promote the duplicate in place. Keeping its UUID
  -- carries every reference atomically; the seed's own upsert then corrects
  -- the remaining columns on the next `pnpm db:seed`.
  IF keep_id IS NULL THEN
    UPDATE public.movements
       SET slug = 'copenhagen-plank',
           display_name = 'Copenhagen Plank',
           pattern = 'isolation',
           primary_muscles = '{adductors,abs,obliques}'::muscle[],
           high_strain_tendon = false,
           stability = 'free',
           experience_min = 2,
           metadata = '{"protocol":"isometric"}'::jsonb
     WHERE id = dup_id;
    RETURN;
  END IF;

  -- ── Repoint plain uuid references ───────────────────────────────────────
  UPDATE public.set_logs SET movement_id = keep_id WHERE movement_id = dup_id;
  UPDATE public.cardio_logs SET movement_id = keep_id WHERE movement_id = dup_id;

  -- Composite PK (session_id, movement_id): a session holding BOTH rows would
  -- collide, so drop the duplicate's row there first.
  DELETE FROM public.session_movements dup
   WHERE dup.movement_id = dup_id
     AND EXISTS (
       SELECT 1 FROM public.session_movements keep
        WHERE keep.session_id = dup.session_id
          AND keep.movement_id = keep_id
     );
  UPDATE public.session_movements SET movement_id = keep_id WHERE movement_id = dup_id;

  -- Unique (user_id, movement_id): keep the survivor's existing training max,
  -- which is the one the lifter has actually been training against.
  DELETE FROM public.training_maxes dup
   WHERE dup.movement_id = dup_id
     AND EXISTS (
       SELECT 1 FROM public.training_maxes keep
        WHERE keep.user_id = dup.user_id
          AND keep.movement_id = keep_id
     );
  UPDATE public.training_maxes SET movement_id = keep_id WHERE movement_id = dup_id;

  -- Partial unique index on pending suggestions (0032): a pending suggestion
  -- for the survivor already covers the same decision.
  DELETE FROM public.tm_suggestions dup
   WHERE dup.movement_id = dup_id
     AND dup.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.tm_suggestions keep
        WHERE keep.user_id = dup.user_id
          AND keep.movement_id = keep_id
          AND keep.status = 'pending'
     );
  UPDATE public.tm_suggestions SET movement_id = keep_id WHERE movement_id = dup_id;

  -- `trigger_key` embeds the movement UUID and is partially unique (0015).
  -- Rewrite it so the survivor keeps the idempotency contract; where the
  -- rewritten key would collide with an existing one, drop the key rather than
  -- the row — it only guards future inserts, the TM change itself is history.
  UPDATE public.tm_history h
     SET movement_id = keep_id,
         trigger_key = CASE
           WHEN h.trigger_key IS NULL THEN NULL
           WHEN EXISTS (
             SELECT 1 FROM public.tm_history other
              WHERE other.id <> h.id
                AND other.trigger_key
                    = replace(h.trigger_key, dup_id::text, keep_id::text)
           ) THEN NULL
           ELSE replace(h.trigger_key, dup_id::text, keep_id::text)
         END
   WHERE h.movement_id = dup_id;

  -- Unique (session_id, from_movement_id). A row recording a swap BETWEEN the
  -- two duplicates becomes a meaningless self-swap once they are one movement.
  DELETE FROM public.limitation_adjustments
   WHERE from_movement_id = dup_id AND to_movement_id = keep_id;
  DELETE FROM public.limitation_adjustments dup
   WHERE dup.from_movement_id = dup_id
     AND EXISTS (
       SELECT 1 FROM public.limitation_adjustments keep
        WHERE keep.session_id = dup.session_id
          AND keep.from_movement_id = keep_id
     );
  UPDATE public.limitation_adjustments
     SET from_movement_id = keep_id,
         from_name = 'Copenhagen Plank'
   WHERE from_movement_id = dup_id;
  UPDATE public.limitation_adjustments
     SET to_movement_id = keep_id,
         to_name = 'Copenhagen Plank'
   WHERE to_movement_id = dup_id;

  -- ── Repoint uuid arrays ─────────────────────────────────────────────────
  -- Per-user limitation allow/deny lists. Append the survivor only when it is
  -- not already listed, then strip the duplicate.
  UPDATE public.limitations
     SET affected_movement_ids =
           array_remove(
             CASE WHEN keep_id = ANY(affected_movement_ids)
                  THEN affected_movement_ids
                  ELSE array_append(affected_movement_ids, keep_id)
             END,
             dup_id
           )
   WHERE dup_id = ANY(affected_movement_ids);

  UPDATE public.limitations
     SET allowed_movement_ids =
           array_remove(
             CASE WHEN keep_id = ANY(allowed_movement_ids)
                  THEN allowed_movement_ids
                  ELSE array_append(allowed_movement_ids, keep_id)
             END,
             dup_id
           )
   WHERE dup_id = ANY(allowed_movement_ids);

  -- ── Repoint JSONB references ────────────────────────────────────────────
  -- Prescriptions embed movementSlug / movementName copies alongside the id,
  -- so all three have to move together or the card renders the dead name.
  UPDATE public.planned_sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = dup_id::text
                          THEN item || jsonb_build_object(
                                 'movementId', keep_id::text,
                                 'movementSlug', 'copenhagen-plank',
                                 'movementName', 'Copenhagen Plank'
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
           jsonb_build_object('movementId', dup_id::text)
         );

  UPDATE public.sessions
     SET prescription = jsonb_set(
           prescription,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = dup_id::text
                          THEN item || jsonb_build_object(
                                 'movementId', keep_id::text,
                                 'movementSlug', 'copenhagen-plank',
                                 'movementName', 'Copenhagen Plank'
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
           jsonb_build_object('movementId', dup_id::text)
         );

  -- Per-session accessory card order — a plain array of movement ids. Drop the
  -- duplicate where the survivor is already listed, otherwise swap it in place.
  UPDATE public.sessions
     SET custom_accessory_order = (
           SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
             FROM jsonb_array_elements(custom_accessory_order)
                  WITH ORDINALITY AS t(elem, ord)
            WHERE elem #>> '{}' <> dup_id::text
         )
   WHERE jsonb_typeof(custom_accessory_order) = 'array'
     AND custom_accessory_order @> to_jsonb(dup_id::text)
     AND custom_accessory_order @> to_jsonb(keep_id::text);

  UPDATE public.sessions
     SET custom_accessory_order = (
           SELECT COALESCE(
                    jsonb_agg(
                      CASE WHEN elem #>> '{}' = dup_id::text
                           THEN to_jsonb(keep_id::text)
                           ELSE elem
                      END
                      ORDER BY ord
                    ),
                    '[]'::jsonb
                  )
             FROM jsonb_array_elements(custom_accessory_order)
                  WITH ORDINALITY AS t(elem, ord)
         )
   WHERE jsonb_typeof(custom_accessory_order) = 'array'
     AND custom_accessory_order @> to_jsonb(dup_id::text);

  -- Saved rehab protocols reference movements by id + denormalised name.
  UPDATE public.rehab_protocols
     SET definition = jsonb_set(
           definition,
           '{items}',
           (
             SELECT jsonb_agg(
                      CASE
                        WHEN item->>'movementId' = dup_id::text
                          THEN item || jsonb_build_object(
                                 'movementId', keep_id::text,
                                 'movementName', 'Copenhagen Plank'
                               )
                        ELSE item
                      END
                      ORDER BY ord
                    )
             FROM jsonb_array_elements(definition->'items') WITH ORDINALITY AS t(item, ord)
           )
         )
   WHERE jsonb_typeof(definition->'items') = 'array'
     AND definition->'items' @> jsonb_build_array(
           jsonb_build_object('movementId', dup_id::text)
         );

  -- ── Drop the duplicate ──────────────────────────────────────────────────
  -- `movement_instructions` cascades. Everything that RESTRICTs has been
  -- repointed above, so this cannot fail on a live reference; if it ever does,
  -- the whole migration rolls back rather than half-merging.
  DELETE FROM public.movements WHERE id = dup_id;
END $$;
