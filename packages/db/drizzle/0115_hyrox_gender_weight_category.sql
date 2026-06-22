-- 0115_hyrox_gender_weight_category.sql
--
-- HYROX gender / competition weight-category.
--
-- Adds a nullable `gender` enum to profiles. HYROX defines separate men's and
-- women's station standards (sled / sandbag / farmers / wall-ball loads + the
-- wall-ball target height); that data already lives in packages/hyrox
-- divisions.ts. Capturing the athlete's weight category lets the prescription
-- surface the gender-correct load instead of showing both ("M x / W y") and
-- asking the user to pick at log time.
--
-- Purely additive + nullable: existing profiles are unaffected (NULL preserves
-- the prior show-both behaviour). Profiles RLS already enforces row ownership.

DO $$ BEGIN
  CREATE TYPE public.gender AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender public.gender;
