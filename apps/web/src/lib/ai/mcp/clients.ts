/**
 * Allowlist of external MCP clients permitted to authorize against this
 * server. ADR 0003 §"OAuth 2.1 + Supabase Auth bridge" + PR #194 code
 * review (Fix #4 — client allowlist + redirect_uri pattern check).
 *
 * Each entry binds a `client_id` to:
 *   - a human-readable `displayName` shown on the consent screen
 *     (never the raw client_id — that's an opaque token the user does
 *     not need to read), and
 *   - a `redirectUriPattern` the requested `redirect_uri` MUST fully
 *     match. This blocks open-redirect-style abuse where an attacker
 *     forges an authorization request that bounces the code to a
 *     server they control.
 *
 * Unknown client_ids are rejected at /authorize with `invalid_client`.
 * Mismatched redirect URIs are rejected with `invalid_redirect_uri`.
 *
 * TODO: verify exact callback URLs from each host's published docs.
 * Sources attempted (2026-05-28):
 *   - Anthropic custom-connectors docs (claude.ai/api/mcp/auth_callback
 *     observed in connector OAuth traffic but not authoritatively
 *     documented). Pattern below is a starting heuristic.
 *   - ChatGPT custom-connector docs — connector callbacks appear under
 *     chat.openai.com / chatgpt.com (both domains in use during the
 *     domain migration); both allowed below.
 *   - Cursor — uses a `cursor://` custom URI scheme for OAuth callbacks.
 *   - Claude Desktop — uses a loopback redirect on localhost (port
 *     ephemeral), per the standard "Native App" pattern (RFC 8252 §7.3).
 * Flag in the PR comment that these patterns are best-effort and need
 * confirmation from each host's official OAuth setup docs.
 */
export type McpClientDescriptor = {
  id: string;
  displayName: string;
  redirectUriPattern: RegExp;
};

export const ALLOWED_MCP_CLIENTS: ReadonlyArray<McpClientDescriptor> = [
  {
    id: "claude-web",
    displayName: "Claude Web",
    // TODO: verify — Anthropic custom-connectors docs.
    redirectUriPattern: /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/,
  },
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    // RFC 8252 §7.3 loopback redirect — host + ephemeral port.
    redirectUriPattern: /^https?:\/\/localhost(:\d+)?\/.*$/,
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    // TODO: verify — both chat.openai.com and chatgpt.com observed
    // during the domain migration; allow both.
    redirectUriPattern:
      /^https:\/\/(?:chat\.openai\.com|chatgpt\.com)\/.*$/,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    // TODO: verify — Cursor uses a custom URI scheme for OAuth callback.
    redirectUriPattern: /^cursor:\/\/.*$/,
  },
];

export function findAllowedClient(
  clientId: string,
): McpClientDescriptor | null {
  return ALLOWED_MCP_CLIENTS.find((c) => c.id === clientId) ?? null;
}

export function isAllowedRedirectUri(
  client: McpClientDescriptor,
  redirectUri: string,
): boolean {
  return client.redirectUriPattern.test(redirectUri);
}
