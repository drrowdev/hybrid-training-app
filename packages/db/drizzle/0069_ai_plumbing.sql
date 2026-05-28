-- 0069_ai_plumbing.sql
--
-- ADR 0002 — AI architecture (Explain v1 + BYOAI). PR 1 of 2.
--
-- This is the foundations migration: schema additions only. No chat
-- surface, no orchestrator, no `getEngineSnapshot` tool wiring. Those
-- ship in PR 2.
--
-- ─────────────────────────────────────────────────────────────────────
-- Vault path choice — pgcrypto fallback
-- ─────────────────────────────────────────────────────────────────────
-- The ADR specifies Supabase Vault as the at-rest cipher for BYOAI
-- keys. Vault is a Supabase-managed extension whose availability
-- varies by project tier and rollout status. To keep the migration
-- deterministic across local dev / CI / hosted Supabase, we ship the
-- pgcrypto fallback path: a `byoai_key_secrets` table whose
-- `encrypted_key` bytea column is written/read by the application
-- layer via `pgp_sym_encrypt` / `pgp_sym_decrypt` with a master key
-- sourced from the `AI_KEY_ENCRYPTION_KEY` env var (server-side only).
--
-- The application helper API (`storeByoaiKey` / `decryptByoaiKey` /
-- `clearByoaiKey`) is identical to what it would look like with
-- Vault, so swapping in `vault.create_secret` / `vault.decrypted_secrets`
-- later is a localised change inside `apps/web/src/lib/ai/vault.ts`
-- with zero schema impact.
--
-- pgcrypto is enabled below; it's a core PostgreSQL contrib module
-- and is GA on every Supabase project tier.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ─────────────────────────────────────────────────────────────────────
-- 1) profiles — additive BYOAI columns
-- ─────────────────────────────────────────────────────────────────────
-- `ai_opt_in_at`        — when the user toggled the master AI switch on;
--                         NULL = opted out (current state of every row).
-- `byoai_provider`      — which provider the user's key targets.
-- `byoai_key_vault_id`  — opaque reference into the secret store
--                         (Vault entry id or `byoai_key_secrets.id`).
-- `byoai_unlocked_at`   — reserved for a future one-time-payment
--                         unlock. We default to `now()` so the free-
--                         tier `hasAiAccess` check treats every user
--                         as unlocked today; if/when the paid unlock
--                         lands, existing rows stay unlocked and only
--                         new signups follow the new gate.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_opt_in_at        timestamptz,
  ADD COLUMN IF NOT EXISTS byoai_provider      text,
  ADD COLUMN IF NOT EXISTS byoai_key_vault_id  text,
  ADD COLUMN IF NOT EXISTS byoai_unlocked_at   timestamptz DEFAULT now();

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_byoai_provider_check
  CHECK (byoai_provider IS NULL
         OR byoai_provider IN ('anthropic', 'openai', 'gemini'));

-- ─────────────────────────────────────────────────────────────────────
-- 2) chat_threads — one row per conversation
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_user_updated_idx
  ON public.chat_threads (user_id, updated_at DESC);

CREATE TRIGGER chat_threads_set_updated_at
  BEFORE UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_threads_select_self
  ON public.chat_threads FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY chat_threads_insert_self
  ON public.chat_threads FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY chat_threads_update_self
  ON public.chat_threads FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY chat_threads_delete_self
  ON public.chat_threads FOR DELETE
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.chat_threads
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3) chat_messages — verbatim per-turn history
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content       text,
  tool_calls    jsonb,
  tool_results  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
  ON public.chat_messages (thread_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_select_self
  ON public.chat_messages FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY chat_messages_insert_self
  ON public.chat_messages FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY chat_messages_update_self
  ON public.chat_messages FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY chat_messages_delete_self
  ON public.chat_messages FOR DELETE
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.chat_messages
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) memories — persistent AI-curated facts (240-char UX cap)
-- ─────────────────────────────────────────────────────────────────────
-- The 240-char cap is a UX guardrail (keeps a memory fit-on-one-line
-- in the Settings → AI panel later). It is NOT a CP-2 calibration
-- constant — see CP compliance in the PR body.

CREATE TABLE IF NOT EXISTS public.memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text        text NOT NULL CHECK (char_length(text) <= 240),
  category    text NOT NULL CHECK (category IN ('preference', 'fact', 'goal', 'constraint', 'context')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_user_idx
  ON public.memories (user_id);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY memories_select_self
  ON public.memories FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY memories_insert_self
  ON public.memories FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY memories_update_self
  ON public.memories FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY memories_delete_self
  ON public.memories FOR DELETE
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.memories
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5) byoai_key_events — append-only audit log
-- ─────────────────────────────────────────────────────────────────────
-- NEVER stores the key value itself. Records only that an action
-- happened, by whom, against which provider.

CREATE TABLE IF NOT EXISTS public.byoai_key_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text NOT NULL CHECK (action IN ('set', 'rotate', 'clear')),
  provider    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS byoai_key_events_user_created_idx
  ON public.byoai_key_events (user_id, created_at DESC);

ALTER TABLE public.byoai_key_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY byoai_key_events_select_self
  ON public.byoai_key_events FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY byoai_key_events_insert_self
  ON public.byoai_key_events FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT
  ON public.byoai_key_events
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6) ai_call_logs — per-LLM-call observability
-- ─────────────────────────────────────────────────────────────────────
-- Privacy contract enforced at the application layer (see
-- `apps/web/src/lib/ai/observability.ts`): this row contains NO raw
-- prompt text, NO raw tool arguments, and NO raw assistant response
-- content. Only metadata (counts, hashes, names, codes, latencies,
-- token usage).

CREATE TABLE IF NOT EXISTS public.ai_call_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  prompt_hash         text NOT NULL,
  tool_calls          jsonb,
  validation_result   text NOT NULL CHECK (validation_result IN ('ok', 'retry-needed', 'failed')),
  retry_count         smallint NOT NULL DEFAULT 0,
  latency_ms          integer NOT NULL,
  usage               jsonb,
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_call_logs_user_created_idx
  ON public.ai_call_logs (user_id, created_at DESC);

ALTER TABLE public.ai_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_call_logs_select_self
  ON public.ai_call_logs FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY ai_call_logs_insert_self
  ON public.ai_call_logs FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT
  ON public.ai_call_logs
  TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7) byoai_key_secrets — pgcrypto fallback secret store
-- ─────────────────────────────────────────────────────────────────────
-- `encrypted_key` holds the ciphertext written by
-- `pgp_sym_encrypt(plaintext, master_key)`. The master_key is the
-- server-side `AI_KEY_ENCRYPTION_KEY` env var and is NEVER stored in
-- the database.
--
-- RLS is enforced for defence in depth — even with the service-role
-- bypass that decrypts on the server, end-users cannot reach this
-- table from any client surface. We grant SELECT/INSERT/UPDATE/DELETE
-- only to `service_role`; `authenticated` gets nothing. There is also
-- no policy for `authenticated`, so RLS would block them even if the
-- grant existed.

CREATE TABLE IF NOT EXISTS public.byoai_key_secrets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_key   bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS byoai_key_secrets_user_idx
  ON public.byoai_key_secrets (user_id);

CREATE TRIGGER byoai_key_secrets_set_updated_at
  BEFORE UPDATE ON public.byoai_key_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.byoai_key_secrets ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon — default-deny. service_role
-- bypasses RLS by definition; the SECURITY DEFINER RPCs below are
-- how the app layer reads/writes ciphertext under the caller's
-- identity without exposing the bytea to client JS.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.byoai_key_secrets
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 8) SECURITY DEFINER RPCs — application surface for the fallback path
-- ─────────────────────────────────────────────────────────────────────
-- These wrap pgp_sym_encrypt/decrypt so the helper module in
-- `apps/web/src/lib/ai/vault.ts` can use a plain Supabase client
-- (service-role) without writing inline SQL. The master_key argument
-- is supplied by the server-side env var on every call — it is NOT
-- baked into the function definition.

CREATE OR REPLACE FUNCTION public.byoai_store_key(
  p_user_id uuid,
  p_plaintext text,
  p_master_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.byoai_key_secrets (user_id, encrypted_key)
  VALUES (p_user_id, pgp_sym_encrypt(p_plaintext, p_master_key))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.byoai_decrypt_key(
  p_user_id uuid,
  p_vault_id uuid,
  p_master_key text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_text text;
BEGIN
  -- Defense-in-depth: even though only service_role can EXECUTE this
  -- function, require the caller to assert which user_id they're
  -- decrypting for. A leaked vault_id alone is not enough to cross
  -- user boundaries; the caller must also know the matching user_id.
  SELECT pgp_sym_decrypt(encrypted_key, p_master_key)
    INTO v_text
    FROM public.byoai_key_secrets
   WHERE id = p_vault_id
     AND user_id = p_user_id;
  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.byoai_clear_key(
  p_user_id uuid,
  p_vault_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Same defense-in-depth as byoai_decrypt_key.
  DELETE FROM public.byoai_key_secrets
    WHERE id = p_vault_id
      AND user_id = p_user_id;
END;
$$;

-- The RPCs are only callable by service_role. The client never sees
-- the master key, never reads the bytea, never invokes the RPCs.
REVOKE ALL ON FUNCTION public.byoai_store_key(uuid, text, text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.byoai_decrypt_key(uuid, uuid, text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.byoai_clear_key(uuid, uuid)               FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.byoai_store_key(uuid, text, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.byoai_decrypt_key(uuid, uuid, text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.byoai_clear_key(uuid, uuid)               TO service_role;
