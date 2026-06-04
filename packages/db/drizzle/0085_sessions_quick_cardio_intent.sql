-- 0085_sessions_quick_cardio_intent.sql
--
-- Native cardio Phase 0 — route Quick run/ride into the live GPS tracker.
--
-- Quick cardio workouts (Today page "Quick workout" sheet -> Run / Ride /
-- Other) previously created a prescription-free session AND immediately
-- inserted a `cardio_logs` row for the chosen duration. That pre-logged row
-- tripped the session page's `hasLoggedCardioRow` guard, which gates OUT the
-- `LiveCardioTracker` (the live clock + GPS distance/pace capture). The user
-- therefore saw a bare read-only "run / 90 min + finish" card with no live
-- tracking — the opposite of the intended experience.
--
-- The fix stops pre-logging and instead records the quick-cardio INTENT on the
-- session itself (chosen modality + target duration). The session page reads
-- these to open the live tracker; the real `cardio_logs` row is written on
-- finish by the existing `logCardioSession` action. These two columns are the
-- minimal persistence for that intent.
--
-- Both columns are nullable: NULL = not a quick-cardio session (every existing
-- row, plus all planned + strength sessions) and reproduces prior behaviour
-- byte-for-byte. No backfill needed.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS quick_cardio_modality text;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS quick_cardio_duration_sec integer;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_quick_cardio_duration_chk;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_quick_cardio_duration_chk
    CHECK (
      quick_cardio_duration_sec IS NULL
      OR (quick_cardio_duration_sec >= 60 AND quick_cardio_duration_sec <= 36000)
    );
