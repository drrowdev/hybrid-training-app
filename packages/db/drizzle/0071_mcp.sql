-- 0071_mcp.sql
--
-- ADR 0003 — MCP server + in-app chat dual path. PR A schema.
--
-- Two additive tables, both metadata-only, both with strict RLS:
--   * mcp_tool_calls     — per-tool-call observability (no input args,
--                          no output bytes; only counters + names).
--   * mcp_authorizations — per-(user, external client) lifecycle audit
--                          (authorize / revoke). No token material is
--                          ever stored.
--
-- Privacy contract — identical to ai_call_logs (ADR 0002):
--   * No raw tool input arguments.
--   * No raw tool output bytes / content.
--   * No bearer tokens, no shared secrets, no PII beyond user_id.
-- The TypeScript layer enforces the same `RejectIfContainsContent<T>`
-- type guard at the insert site so a future refactor cannot bypass
-- this contract.
--
-- All writes happen server-side under service_role from the MCP route;
-- the user-facing RLS policies allow SELECT-self only. INSERT/UPDATE/
-- DELETE for authenticated end-users are denied by default-deny RLS.

-- ─────────────────────────────────────────────────────────────────────
-- mcp_tool_calls — per-call observability
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name          text NOT NULL,
  latency_ms         integer NOT NULL,
  result_size_bytes  integer NOT NULL,
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_user_created_idx
  ON public.mcp_tool_calls (user_id, created_at DESC);

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_tool_calls_select_self
  ON public.mcp_tool_calls FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Writes are server-only via service_role. No INSERT/UPDATE/DELETE
-- policies for `authenticated` — default-deny applies.
GRANT SELECT ON public.mcp_tool_calls TO authenticated;
GRANT SELECT, INSERT ON public.mcp_tool_calls TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- mcp_authorizations — OAuth lifecycle audit
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.mcp_authorizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id   text NOT NULL,
  event       text NOT NULL CHECK (event IN ('authorize', 'revoke')),
  scope       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_authorizations_user_created_idx
  ON public.mcp_authorizations (user_id, created_at DESC);

ALTER TABLE public.mcp_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_authorizations_select_self
  ON public.mcp_authorizations FOR SELECT
  USING (user_id = (SELECT auth.uid()));

GRANT SELECT ON public.mcp_authorizations TO authenticated;
GRANT SELECT, INSERT ON public.mcp_authorizations TO service_role;
