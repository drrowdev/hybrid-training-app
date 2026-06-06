-- 0090_byoai_pgcrypto_search_path
-- ─────────────────────────────────────────────────────────────────────
-- Fix: BYOAI key save/decrypt fail with
--   "function pgp_sym_encrypt(text, text) does not exist" (SQLSTATE 42883).
--
-- Root cause: on Supabase, pgcrypto is pre-installed in the `extensions`
-- schema. 0069's `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`
-- was therefore a no-op (the extension already existed in `extensions`), so
-- `pgp_sym_encrypt` / `pgp_sym_decrypt` live in `extensions` — but the
-- SECURITY DEFINER RPCs were created with `SET search_path = public`, which
-- excludes `extensions`. The unqualified pgcrypto calls could never resolve,
-- so every key save and decrypt failed.
--
-- Fix: re-create the two pgcrypto-using RPCs with `search_path = public,
-- extensions` so the calls resolve wherever pgcrypto lives (public on a
-- vanilla Postgres where the original CREATE EXTENSION took effect, or
-- extensions on Supabase). Bodies are otherwise byte-identical to 0069.
-- `byoai_clear_key` doesn't touch pgcrypto and is left as-is.

CREATE OR REPLACE FUNCTION public.byoai_store_key(
  p_user_id uuid,
  p_plaintext text,
  p_master_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
SET search_path = public, extensions
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
