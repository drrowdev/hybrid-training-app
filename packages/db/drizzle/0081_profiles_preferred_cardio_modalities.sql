-- 0081_profiles_preferred_cardio_modalities.sql
--
-- ADR 0017 — ranked cardio-modality preference.
--
-- Running is the default cardio form at block creation. This column lets a
-- user declare a RANKED allow-list of cardio modalities (e.g. ['cycling',
-- 'rowing']) so the planner substitutes the prescribed running movement for
-- a same-intensity (cardioKind) movement in the user's preferred modality at
-- block-creation time. The list is ordered: index 0 is the first choice. When
-- the preferred modality has no movement of the prescribed intensity (e.g.
-- swimming has no VO2 protocol in the catalog), the planner falls back down
-- the list and finally to running — the only modality with a full intensity
-- ladder. Equipment ownership is applied as a filter on top; experience tier
-- is respected. See `apps/web/src/lib/planner/preferred-cardio-modality.ts`.
--
-- NULL / empty array reproduces the pre-ADR-0017 prescription byte-for-byte
-- (everyone keeps running), so no backfill is needed and the change is a no-op
-- for every existing row and for users who never set a preference. Generation-
-- time only — changing it never retro-edits an already-created block.
--
-- Allowed values mirror the movement-catalog `metadata.modality` vocabulary
-- the planner can substitute toward. 'running' is intentionally allowed in the
-- list (a user may rank running first explicitly) but is also the implicit
-- terminal fallback.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_cardio_modalities text[];

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_cardio_modalities_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_cardio_modalities_chk
    CHECK (
      preferred_cardio_modalities IS NULL
      OR (
        -- bounded length (defensive against unbounded writes)
        array_length(preferred_cardio_modalities, 1) IS NULL
        OR array_length(preferred_cardio_modalities, 1) <= 8
      )
      AND preferred_cardio_modalities <@ ARRAY[
        'running','cycling','rowing','swimming','rucking',
        'sled','elliptical','stair','ski_erg'
      ]::text[]
    );
