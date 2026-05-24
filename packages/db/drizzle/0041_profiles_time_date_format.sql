-- 0041_profiles_time_date_format.sql
--
-- User-selectable wall-clock formatting preferences. Two nullable
-- columns on `profiles`:
--
--   * `time_format` — '12h' | '24h'. NULL = derive from locale at
--     read time (timezone-region heuristic in
--     `apps/web/src/lib/format/datetime.ts::resolveTimeFormat`).
--   * `date_format` — 'iso' | 'dmy_long' | 'mdy_long' | 'dmy_short' |
--     'mdy_short'. NULL = derive from locale, same fallback path.
--
-- Both columns are intentionally nullable + free-of-default. A NULL is
-- the signal "use the timezone-inferred default" — once the user
-- explicitly picks an option in /app/settings, the column flips to
-- the chosen string and stays there.
--
-- Constraints are guard-rails against bad writes; the server action
-- (apps/web/src/lib/settings/format-actions.ts) validates the same
-- enum before hitting the DB.
--
-- RLS: inherits the existing `profiles_self` SELECT/UPDATE policies
-- via the unchanged `id = auth.uid()` predicate. No policy edits.
--
-- Backfill: none. Existing rows stay NULL → locale-derived defaults
-- continue to apply for everyone who hasn't changed their preference.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS time_format text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_format text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_time_format_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_time_format_chk
        CHECK (time_format IS NULL OR time_format IN ('12h', '24h'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_date_format_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_date_format_chk
        CHECK (date_format IS NULL OR date_format IN ('iso', 'dmy_long', 'mdy_long', 'dmy_short', 'mdy_short'));
  END IF;
END $$;
