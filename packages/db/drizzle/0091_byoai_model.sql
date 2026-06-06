-- 0091_byoai_model
-- ─────────────────────────────────────────────────────────────────────
-- Adds profiles.byoai_model — the user's chosen model id for their BYOAI
-- provider (model picker). Null means "use the provider default". The value
-- is validated against the curated catalogue in lib/ai/models.ts before write,
-- and the resolver falls back to the default if it's null or stale.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS byoai_model text;
