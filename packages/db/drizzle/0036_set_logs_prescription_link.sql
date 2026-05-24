-- 0036_set_logs_prescription_link.sql
--
-- Wire `set_logs` to the planned-session prescription that produced them.
--
-- Before this migration the only way to know which prescription item a
-- given logged set "satisfied" was to best-effort match on
-- (movement_id, set_kind, weight_kg, reps). That's lossy: two
-- prescription items can target the same movement (e.g. main + back-off
-- on Squat), and the match breaks the moment the user tweaks the weight
-- from the prescribed value. So the session detail page couldn't paint
-- a reliable per-item "done" check.
--
-- We add a nullable `prescription_item_index` smallint pointing at the
-- index inside `planned_sessions.prescription.items` whose click
-- prefilled the logger. Nullable because:
--   * Sets added by the legacy free-form picker have no prescription
--     link (and never will retroactively).
--   * Sets logged on freestyle sessions (no linked planned_session)
--     have nothing to point at.
--
-- No CHECK constraint on the value range — `prescription.items` is a
-- jsonb array owned by the planner library, so an index that goes
-- out-of-bounds after a swap is best handled in app code (we just
-- treat unknown indices as "no link" when reading).
--
-- RLS: inherits the existing `set_logs_self` policy through the
-- session_id → sessions.user_id join; no policy edits needed.
ALTER TABLE public.set_logs
  ADD COLUMN IF NOT EXISTS prescription_item_index smallint;

-- Lookup index for the page-render path: given a session + prescription,
-- find which item indices already have at least one matching set.
CREATE INDEX IF NOT EXISTS set_logs_session_pi_idx
  ON public.set_logs (session_id, prescription_item_index)
  WHERE prescription_item_index IS NOT NULL;
