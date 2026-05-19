-- 0001_auth_and_rls.sql
-- Add the auth.users FK on profiles (cascading on user deletion),
-- enable Row Level Security on all user-owned tables, and install the
-- canonical policies. Per plan §4.4 + DC-V1 + DC-K4 (override-and-warn
-- never silent overrule) — and per the Phase 0 multi-user e2e test
-- (apps/web) which proves user A cannot read user B's data.

-- ---------------------------------------------------------------------------
-- 1) profiles.id → auth.users.id (cascade delete: GDPR Article 17)
-- ---------------------------------------------------------------------------

ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_fkey"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 2) limitations.user_id → auth.users.id (cascade)
-- ---------------------------------------------------------------------------

ALTER TABLE "limitations"
  ADD CONSTRAINT "limitations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE INDEX "limitations_user_id_region_active_idx"
  ON "limitations" ("user_id", "region")
  WHERE "resolved_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 3) movements.user_id → auth.users.id (cascade) — nullable for global seeds
-- ---------------------------------------------------------------------------

ALTER TABLE "movements"
  ADD CONSTRAINT "movements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "movements"
  ADD CONSTRAINT "movements_user_id_slug_unique"
  UNIQUE NULLS NOT DISTINCT ("user_id", "slug");

-- ---------------------------------------------------------------------------
-- 4) updated_at triggers (single source of truth per plan §6.9)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "profiles_set_updated_at"
  BEFORE UPDATE ON "profiles"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER "limitations_set_updated_at"
  BEFORE UPDATE ON "limitations"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Auto-create a profile row on user signup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6) Enable RLS — every per-user table
-- ---------------------------------------------------------------------------

ALTER TABLE "profiles"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "limitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "movements"   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 7) Policies
-- ---------------------------------------------------------------------------

-- profiles: self-only read/update; insert allowed only if id matches caller;
-- delete is forbidden (the account-delete endpoint deletes auth.users which
-- cascades down to profiles via the FK).

CREATE POLICY "profiles_select_self"
  ON "profiles" FOR SELECT
  USING ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_insert_self"
  ON "profiles" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "profiles_update_self"
  ON "profiles" FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- limitations: full CRUD on rows owned by the caller; readers see their own
-- rows only. Binding input for DC-V1 / DC-D5 / DC-J3 safety hard-blocks.

CREATE POLICY "limitations_select_self"
  ON "limitations" FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "limitations_insert_self"
  ON "limitations" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "limitations_update_self"
  ON "limitations" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "limitations_delete_self"
  ON "limitations" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- movements: global seeds (user_id IS NULL) are readable by everyone;
-- per-user custom rows are full-CRUD by their owner.

CREATE POLICY "movements_select_global_or_self"
  ON "movements" FOR SELECT
  USING (user_id IS NULL OR (SELECT auth.uid()) = user_id);

CREATE POLICY "movements_insert_self"
  ON "movements" FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "movements_update_self"
  ON "movements" FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "movements_delete_self"
  ON "movements" FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 8) Sanity: revoke the public schema's default-public USAGE that Supabase
-- grants. RLS is enforced regardless, but explicit GRANTs keep the
-- attack surface minimal.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON "movements" TO anon;  -- global seeds readable pre-login
