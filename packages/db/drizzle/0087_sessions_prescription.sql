-- 0087_sessions_prescription.sql
--
-- Off-plan prescriptions on sessions (quick-generate, ADR 0029).
--
-- The "Generate quick strength workout" flow builds a real prescription but had
-- nowhere to store it: the session page renders the grouped "MAIN LIFTS /
-- ACCESSORY WORK" layout and the "X of Y sets logged" counter ONLY from a
-- linked `planned_sessions.prescription`. An off-plan quick session has no
-- planned_sessions row, so it fell back to the flat freestyle list AND (because
-- the materialiser pre-inserted set_logs) immediately read "N of N logged".
--
-- This column lets an off-plan session carry its own prescription. The session
-- page sources its prescription from `planned_sessions.prescription` first, then
-- falls back to `sessions.prescription`, so a generated session renders exactly
-- like a planned one and starts at "0 of N logged" (no pre-inserted set_logs).
--
-- Nullable, no backfill: NULL = no off-plan prescription (every existing row,
-- and every planned/freestyle session) and reproduces prior behaviour exactly.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS prescription jsonb;
