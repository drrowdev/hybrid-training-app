-- 0012_onboarding.sql
-- Mark when a user finished (or skipped) the first-run onboarding wizard.
-- /app/layout.tsx redirects to /onboarding while this is null.

ALTER TABLE "profiles"
  ADD COLUMN "onboarded_at" timestamp with time zone;

-- Grandfather every existing profile: pre-onboarding users shouldn't be
-- forced through the wizard mid-stream.
UPDATE "profiles" SET "onboarded_at" = now() WHERE "onboarded_at" IS NULL;
