-- 0072_mcp_consumed_codes.sql
--
-- ADR 0003 — MCP server. PR #194 follow-up: single-use authorization
-- codes (Fix #2). The OAuth 2.1 spec (RFC 6749 §10.5, OAuth 2.1 draft
-- §4.1.2) requires authorization codes to be single-use; PR A allowed
-- unlimited replay within the 5-minute envelope lifetime. We close that
-- by recording a SHA-256 of every redeemed code and rejecting any code
-- whose hash already exists.
--
-- Storage:
--   * `code_hash` is the primary key — atomic INSERT ... ON CONFLICT
--     DO NOTHING gives us a race-free "redeem exactly once" primitive.
--   * `consumed_at` is the redemption timestamp, used by the TTL
--     cleanup job (any row older than the 5-minute code envelope can
--     never collide with a still-valid code).
--
-- Privacy: only the SHA-256 of the code is stored, never the code
-- itself. Hashes alone reveal nothing about user, client, or scope.
--
-- RLS: this table has no `user_id` and is intentionally service-role
-- only. RLS is enabled in default-deny mode (no policies for
-- `authenticated` / `anon`) so the only path that can read or write
-- is the server-side /mcp/token route via the Supabase service-role
-- key.

CREATE TABLE IF NOT EXISTS public.mcp_consumed_codes (
  code_hash   text PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_consumed_codes_consumed_at_idx
  ON public.mcp_consumed_codes (consumed_at);

ALTER TABLE public.mcp_consumed_codes ENABLE ROW LEVEL SECURITY;

-- No policies: default-deny for `authenticated` and `anon`.
-- Server-side reads/writes use the service-role key which bypasses RLS.

REVOKE ALL ON public.mcp_consumed_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mcp_consumed_codes TO service_role;
