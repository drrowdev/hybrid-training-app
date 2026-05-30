-- 0078_prescription_modifications_rls_fix.sql
--
-- PR #219 review (review-219, Critical #1) caught that migration 0077
-- enabled RLS on `prescription_modifications` but only created a SELECT
-- policy. Server actions in `taper-recovery-actions.ts` write to the
-- table (applyTaperPlan / applyRecoveryPlan / undoTaperPlan /
-- undoRecoveryPlan etc.) via the user-scoped Supabase client; without
-- INSERT/UPDATE policies, Postgres RLS rejects every write — every
-- taper/recovery action would fail at runtime in prod.
--
-- Fix: replace the SELECT-only policy with a single FOR ALL policy
-- that scopes every operation (SELECT/INSERT/UPDATE/DELETE) to the
-- caller's own rows via auth.uid(). Mirrors the pattern used for
-- `priority_events` (migration 0017) and other user-scoped tables.
--
-- Also extend the authenticated GRANT so the role actually has the
-- privilege the policy then allows. The two are independent layers:
-- GRANT controls "can this role touch the table at all?" and RLS
-- controls "which rows specifically?" — both must permit the action.

DROP POLICY IF EXISTS "select own modifications" ON public.prescription_modifications;
DROP POLICY IF EXISTS "own modifications" ON public.prescription_modifications;

CREATE POLICY "own modifications"
  ON public.prescription_modifications FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT + UPDATE are the operations server actions need (DELETE is
-- never used — "undo" updates status='reverted' rather than deleting
-- rows so the audit trail survives). Granting DELETE too costs nothing
-- and matches how other user-scoped tables are wired.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescription_modifications TO authenticated;
