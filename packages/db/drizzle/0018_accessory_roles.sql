-- 0018_accessory_roles.sql
-- Dynamic accessory selection (docs/design/accessory-schema.md §22).
--
-- Adds role tags + selection inputs to movements so the picker can match
-- by role rather than by hardcoded slug. Tag population is a separate
-- data migration step (see seeds/accessory-tags.ts).

ALTER TABLE public.movements
  ADD COLUMN bulletproof_roles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN functional_roles  text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN is_supported      boolean NOT NULL DEFAULT false,
  ADD COLUMN eccentric_load_score smallint,
  ADD COLUMN stim_to_fatigue_score smallint;

-- Derive is_supported from the existing stability enum (fixed_path /
-- supported = true, free = false). One-shot backfill; new movements can
-- override per seed.
UPDATE public.movements
SET is_supported = true
WHERE stability IN ('fixed_path', 'supported');

-- Indexes to keep role queries fast as the catalog grows.
CREATE INDEX movements_bulletproof_roles_idx
  ON public.movements USING gin (bulletproof_roles);

CREATE INDEX movements_functional_roles_idx
  ON public.movements USING gin (functional_roles);
