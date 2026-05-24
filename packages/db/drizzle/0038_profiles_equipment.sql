-- 0038_profiles_equipment.sql
--
-- Adds bar-weight + plate-inventory columns to `profiles` so the
-- session logger can render a plate-per-side breakdown next to the
-- target weight. The columns are pure user equipment metadata:
--
--   * `barbell_kg`         numeric(5,2) NOT NULL DEFAULT 20.00
--                          Standard Olympic men's bar mass.
--   * `trap_bar_kg`        numeric(5,2) NOT NULL DEFAULT 25.00
--                          Typical trap/hex bar mass. Movements whose
--                          slug contains `trap_bar`/`hex_bar` resolve
--                          to this value at the render boundary.
--   * `plate_inventory_kg` jsonb NOT NULL DEFAULT '[...]'
--                          Array of `{ weight_kg, pair_count }` rows.
--                          The default mirrors a sensible Olympic plate
--                          set (25/20/15/10/5/2.5/1.25 kg). The plate
--                          calculator reads this column straight; the
--                          UI converts to lb at the render boundary
--                          when `profiles.units = 'imperial'`.
--
-- All weights are stored in kilograms regardless of the user's
-- `units` preference — keeping the storage canonical avoids the
-- lossy round-trip that `lb`-as-source would introduce for the
-- 1.25 / 2.5 kg micro-plates.
--
-- RLS: inherits the existing `profiles_self` SELECT/UPDATE policies
-- through the unchanged `id = auth.uid()` predicate. No policy edits
-- needed.
--
-- Backfill: every existing row picks up the column defaults. No
-- additional UPDATE statement required.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS barbell_kg numeric(5,2) NOT NULL DEFAULT 20.00;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trap_bar_kg numeric(5,2) NOT NULL DEFAULT 25.00;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plate_inventory_kg jsonb NOT NULL DEFAULT
    '[
      {"weight_kg": 25,   "pair_count": 2},
      {"weight_kg": 20,   "pair_count": 2},
      {"weight_kg": 15,   "pair_count": 1},
      {"weight_kg": 10,   "pair_count": 2},
      {"weight_kg": 5,    "pair_count": 2},
      {"weight_kg": 2.5,  "pair_count": 2},
      {"weight_kg": 1.25, "pair_count": 2}
    ]'::jsonb;
