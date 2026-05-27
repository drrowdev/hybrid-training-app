-- 0059_session_movements.sql
--
-- Persist freestyle ("+ Add off-plan movement") additions inside a
-- session so they survive a page refresh and so a user can remove an
-- accidentally-added movement *before* logging the first set against
-- it. Today the freestyle cards exist only in client state, derived
-- from `set_logs.movement_id distinct`. That works once you've logged
-- a set — anything before that is lost on refresh, and there is no UI
-- (and no row) to delete.
--
-- One row per (session, movement). `sort_order` carries the display
-- order so a future drag-to-reorder lands without a schema change
-- (default 0 today; the action assigns max+10 to leave gaps). `user_id`
-- is denormalised onto the row so RLS policies can match on
-- `auth.uid()` without a join to `sessions`, and so per-user filters
-- in queries are index-friendly — defence-in-depth on top of the
-- `sessions` ownership check the server actions already do.
--
-- Composite primary key (session_id, movement_id) gives us the
-- idempotency guarantee the `addSessionMovementAction` relies on:
-- repeated "add" of the same movement to the same session is a no-op
-- via `ON CONFLICT DO NOTHING`.
--
-- Hard delete (no `deleted_at`) is intentional. The server action
-- refuses removal once any `set_logs` row exists for the pair, so the
-- only deletions that can happen are "I just added this by mistake"
-- — soft-delete would be ceremony for no real history value.

CREATE TABLE IF NOT EXISTS public.session_movements (
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES public.movements(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, movement_id)
);

CREATE INDEX IF NOT EXISTS session_movements_session_idx
  ON public.session_movements (session_id);
CREATE INDEX IF NOT EXISTS session_movements_user_idx
  ON public.session_movements (user_id);

ALTER TABLE public.session_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_movements_select_self ON public.session_movements
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY session_movements_insert_self ON public.session_movements
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY session_movements_delete_self ON public.session_movements
  FOR DELETE USING (auth.uid() = user_id);
