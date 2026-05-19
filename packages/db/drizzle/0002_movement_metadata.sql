-- 0002_movement_metadata.sql
-- Promote muscle tracking + safety/scheduling flags from JSONB metadata
-- to first-class columns per plan §6.8 (fields that are UI-observable +
-- stable enough to never be removed earn a column). Required for:
--   - DC-T1 muscle-priority hypertrophy targets (shoulders 6–12, etc.)
--   - DC-J5 6h tendon refractory (queryable via high_strain_tendon)
--   - DC-D3 conflict matrix (axial_load × rowing volume)
--   - DC-O5 hypertrophy-slot ranking under concurrent stress (stability)

-- ---------------------------------------------------------------------------
-- 1) New enums
-- ---------------------------------------------------------------------------

CREATE TYPE "public"."muscle" AS ENUM (
  'chest', 'upper_chest',
  'front_delts', 'side_delts', 'rear_delts',
  'biceps', 'triceps', 'forearms',
  'traps', 'lats', 'mid_back', 'lower_back',
  'abs', 'obliques',
  'glutes', 'quads', 'hamstrings',
  'adductors', 'abductors',
  'calves', 'tibialis',
  'neck'
);

CREATE TYPE "public"."axial_load" AS ENUM ('low', 'moderate', 'high');

CREATE TYPE "public"."stability" AS ENUM ('free', 'supported', 'fixed_path');

-- ---------------------------------------------------------------------------
-- 2) New columns on movements
-- ---------------------------------------------------------------------------

ALTER TABLE "movements"
  ADD COLUMN "primary_muscles"     "muscle"[] DEFAULT '{}'::muscle[] NOT NULL,
  ADD COLUMN "secondary_muscles"   "muscle"[] DEFAULT '{}'::muscle[] NOT NULL,
  ADD COLUMN "high_strain_tendon"  boolean    DEFAULT false NOT NULL,
  ADD COLUMN "axial_load"          "axial_load" DEFAULT 'low' NOT NULL,
  ADD COLUMN "stability"           "stability"  DEFAULT 'free' NOT NULL,
  ADD COLUMN "bilateral"           boolean    DEFAULT true NOT NULL,
  ADD COLUMN "body_weight_loaded"  boolean    DEFAULT false NOT NULL;

-- Useful index: aesthetics dashboard query
-- "movements that primarily work shoulders" -> GIN on array
CREATE INDEX "movements_primary_muscles_gin_idx"
  ON "movements" USING GIN ("primary_muscles");

CREATE INDEX "movements_secondary_muscles_gin_idx"
  ON "movements" USING GIN ("secondary_muscles");

-- DC-J5 tendon refractory query benefits from partial index
CREATE INDEX "movements_high_strain_tendon_idx"
  ON "movements" ("primary_region")
  WHERE "high_strain_tendon" = true;
