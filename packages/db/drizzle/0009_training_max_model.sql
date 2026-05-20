-- 0009_training_max_model.sql
-- Switch the training_maxes model to (1RM + TM%) instead of bare TM kg.
--
-- The user enters their 1RM (the real number they can hit). A "Training Max"
-- is a deliberate underestimate (typically 85-90% of 1RM) used as the anchor
-- for percentage prescription. A profile-level default TM% (default 90%) lets
-- users set the policy once; a per-movement override is supported.
--
-- Storage:
--   training_maxes.one_rm_kg   — the 1RM the user actually entered (kg)
--   training_maxes.tm_percent  — optional per-movement override (nullable)
--   profiles.tm_percent_default — fallback when per-movement override is null
--
-- Computed TM = one_rm_kg × (tm_percent ?? profile.tm_percent_default) / 100,
-- rounded to the nearest plate increment. Computation lives in the app layer
-- so it can be reused by the planner and the log UI uniformly.

-- 1) Profile gets a default TM%.
ALTER TABLE "profiles"
  ADD COLUMN "tm_percent_default" numeric(4, 1) NOT NULL DEFAULT 90.0
  CHECK ("tm_percent_default" > 0 AND "tm_percent_default" <= 100);

-- 2) training_maxes: rename tm_kg → one_rm_kg, add tm_percent.
ALTER TABLE "training_maxes"
  RENAME COLUMN "tm_kg" TO "one_rm_kg";

ALTER TABLE "training_maxes"
  ADD COLUMN "tm_percent" numeric(4, 1)
  CHECK ("tm_percent" IS NULL OR ("tm_percent" > 0 AND "tm_percent" <= 100));
