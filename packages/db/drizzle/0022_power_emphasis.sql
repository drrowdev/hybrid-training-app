-- 0022_power_emphasis.sql
-- Wizard "Add power emphasis" toggle persistence.
--
-- The wizard exposes the toggle only when the resolved archetype is
-- power-eligible (Strength Focus, Hybrid Focus). When ON, the accessory
-- picker biases the role pool toward power-tagged movements
-- (power_olympic / power_plyometric / power_ballistic) and reduces
-- high-rep hypertrophy fillers — explosive intent vs hypertrophy
-- stimulus conflict (Schoenfeld 2017 review).
--
-- Nullable + default false so old rows + legacy custom blocks keep
-- working unchanged. No top-level RLS change — power_emphasis is a
-- per-block scalar that follows the same training_blocks policies.

ALTER TABLE "training_blocks"
  ADD COLUMN "power_emphasis" boolean DEFAULT false;
