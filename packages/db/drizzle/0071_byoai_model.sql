-- 0071_byoai_model.sql
--
-- feat/ai-model-picker — adds an optional `byoai_model` column on
-- profiles so users can pin a specific provider model ID (curated
-- entry or custom string).
--
-- Design notes:
--   * `text NULL` — when null, the application resolver falls back to
--     `getDefaultModel(provider)` from
--     `apps/web/src/lib/ai/providers/model-catalogue.ts` (Recommended
--     tier per provider).
--   * No enum / no `IN (...)` whitelist — provider model IDs churn on
--     a weeks-to-months cadence and the picker UI also accepts a
--     custom user-supplied ID. The application layer validates the
--     value at write time via the same list-models endpoint used to
--     validate the API key.
--   * Length bounds are a defence-in-depth DOS guard: the longest
--     vendor model ID in circulation today is well under 100 chars,
--     so a 1..200 window leaves room for future variants while
--     blocking absurd inputs from a leaky client surface.
--   * No backfill is needed: existing rows continue working via the
--     default-tier fallback in the resolver.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS byoai_model text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_byoai_model_check
  CHECK (byoai_model IS NULL
         OR (char_length(byoai_model) BETWEEN 1 AND 200));
