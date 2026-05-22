-- 0021_training_experience.sql
-- DC-G5 cold-start tier: a brand-new user's first block defaults to the
-- "consumer" load tier when training_age < 1y. Captured at onboarding so
-- the engine + planner can read it without re-prompting.
--
-- Stored as a free-form text (constrained to the 3 known buckets) rather
-- than a pgEnum to keep migrations cheap and avoid an ALTER TYPE later
-- if we add a fourth bucket (e.g. "elite").

ALTER TABLE "profiles"
  ADD COLUMN "training_experience" text;

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_training_experience_check"
  CHECK ("training_experience" IS NULL OR "training_experience" IN ('lt_1y', '1_3y', 'gte_3y'));
