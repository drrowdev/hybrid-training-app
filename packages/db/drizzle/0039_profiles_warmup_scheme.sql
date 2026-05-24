-- 0039_profiles_warmup_scheme.sql
--
-- Adds a per-user warmup-ladder configuration to `profiles`. Drives the
-- auto-generated warmup items the engine prepends before each main lift
-- when a new block is created.
--
-- Column:
--   * `warmup_scheme` jsonb NULL
--       Shape: { setCount: int, percentLadder: number[], repLadder: number[] }
--       NULL is treated as the default scheme at read time:
--         { setCount: 3, percentLadder: [40, 50, 60], repLadder: [5, 3, 2] }
--       The default mirrors the typical practitioner consensus warmup
--       ladder (rehearse the motor pattern at light loads, then ramp
--       so connective tissue acclimates — Baar 2017 tendon-adaptation
--       literature on submaximal exposure before heavy work).
--   * `setCount = 0` disables auto-warmups entirely (user opts out).
--
-- Backfill: no-op. The column is nullable; the read-side fallback
-- applies the default to any pre-existing row.
--
-- Forward-only behaviour: this migration does NOT rewrite the
-- `prescription` JSONB on existing `planned_sessions`. Auto-warmups
-- only appear on blocks created after this migration ships.
--
-- RLS: inherits the existing `profiles_self` SELECT/UPDATE policies
-- through `id = auth.uid()`. No policy changes required.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS warmup_scheme jsonb;
