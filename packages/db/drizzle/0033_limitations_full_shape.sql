-- 0033_limitations_full_shape.sql
--
-- Extend `limitations` to capture the full self-serve shape surfaced
-- by the new /app/recovery/injuries page.
--
-- The original 0000 table was region-keyed (one of seven engine
-- regions) — fine for the safety hard-blocks, too coarse for users
-- who want to flag "left knee meniscus" without ruling out the whole
-- knee region, or to scope the flag to a specific movement.
--
-- We keep `region` (nullable now — derived from the picker for back
-- compat with the engine) and add:
--
--   * `kind`                   — free-text short descriptor
--                                ("knee", "left shoulder", "lower back").
--   * `affected_muscles`       — text[] of MuscleGroup values from the
--                                16-muscle catalog (see
--                                apps/web/src/lib/muscle/muscle-groups.ts).
--   * `affected_movement_ids`  — uuid[] of explicit movements to
--                                avoid / cap. Soft-reference: not a
--                                real FK array (Postgres doesn't
--                                support FK arrays); the UI scrubs
--                                stale ids on render.
--   * `expected_duration_days` — user estimate.
--   * `engine_action`          — jsonb of what the engine decided to
--                                do because of this row. Engine
--                                writes, user reads.
--
-- `adjustments` (the older catch-all jsonb introduced in 0000) stays
-- in place for back compat — nothing reads it yet, removing it would
-- be a destructive migration for any forks that did.
--
-- RLS: no policy changes. The 0001 policies already gate by
-- `user_id = auth.uid()` for every row, and the new columns inherit
-- that without further work.

ALTER TABLE public.limitations
  ALTER COLUMN region DROP NOT NULL;

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS kind text;

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS affected_muscles text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS affected_movement_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS expected_duration_days integer;

ALTER TABLE public.limitations
  ADD COLUMN IF NOT EXISTS engine_action jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A non-negative sanity check on the duration estimate. Keep it loose
-- — users sometimes guess in years for chronic things.
ALTER TABLE public.limitations
  ADD CONSTRAINT limitations_expected_duration_days_nonneg
    CHECK (expected_duration_days IS NULL OR expected_duration_days >= 0);

-- Index for the muscle-overlap lookup the engine will use to translate
-- "what muscles are flagged?" into ceilings. GIN on the text[] array
-- gives us a cheap `affected_muscles && ARRAY['quads']` membership
-- query.
CREATE INDEX IF NOT EXISTS limitations_affected_muscles_gin_idx
  ON public.limitations USING GIN (affected_muscles)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS limitations_affected_movement_ids_gin_idx
  ON public.limitations USING GIN (affected_movement_ids)
  WHERE resolved_at IS NULL;
