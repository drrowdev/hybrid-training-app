/**
 * GET /mcp/authorize — OAuth 2.1 authorization endpoint for external
 * MCP clients (Claude / ChatGPT / Cursor / Gemini CLI).
 *
 * ADR 0003 §"OAuth 2.1 + Supabase Auth bridge" + PR #194 code review:
 *
 *   - Fix #1: signing key is enforced via `requireSigningKey()`
 *     (>= 32 chars, throws on missing). No `?? ""` fallback that could
 *     let an attacker forge codes against an empty key.
 *
 *   - Fix #3: an authenticated user is no longer immediately redirected
 *     with a freshly-minted code. Instead they see a server-rendered
 *     consent screen that names the requesting client, the scope, and
 *     the redirect_uri the code will be sent to. The user explicitly
 *     POSTs to `/mcp/authorize/confirm` to mint the code. This closes
 *     the phishing path where a malicious site could craft an
 *     authorize URL and silently obtain a code on the user's behalf.
 *
 *   - Fix #4 (bonus): `client_id` is validated against the
 *     `ALLOWED_MCP_CLIENTS` allowlist, and `redirect_uri` must match
 *     the client's published redirect pattern.
 *
 * The consent form carries a signed-state HMAC envelope binding
 * `{ userId, clientId, scope, redirectUri, state, nonce, exp }` so the
 * POST handler can't be tricked with tampered fields, and the
 * signature itself acts as the CSRF token (it pins the userId).
 *
 * Logged-out users are bounced through Supabase Auth (`/login?next=…`)
 * and round-trip back here once the session cookie is set.
 */
import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/supabase/server";
import {
  findAllowedClient,
  isAllowedRedirectUri,
} from "@/lib/ai/mcp/clients";
import { signConsentState } from "@/lib/ai/mcp/authCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizeQuery = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
};

function readQuery(url: URL): AuthorizeQuery | null {
  const responseType = url.searchParams.get("response_type") ?? "";
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const scope = url.searchParams.get("scope") ?? "tools:read";
  const state = url.searchParams.get("state") ?? "";
  if (responseType !== "code") return null;
  if (!clientId || !redirectUri) return null;
  return { responseType, clientId, redirectUri, scope, state };
}

function oauthError(
  error: string,
  message: string,
  status = 400,
): Response {
  return NextResponse.json(
    { error, error_description: message },
    { status },
  );
}

/**
 * Minimal HTML entity escape for the four characters that can break
 * out of HTML element content or attribute context. We do NOT trust
 * `client_id`, `redirect_uri`, `scope`, or `state` to be safe — all
 * user-controlled query strings pass through this before they hit the
 * page. No `dangerouslySetInnerHTML` is used anywhere on this surface.
 */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderConsentPage(args: {
  clientDisplayName: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  signedState: string;
}): string {
  const displayName = escapeHtml(args.clientDisplayName);
  const clientId = escapeHtml(args.clientId);
  const scope = escapeHtml(args.scope);
  const redirectUri = escapeHtml(args.redirectUri);
  const signedState = escapeHtml(args.signedState);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Authorize ${displayName} — S×C</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; background: #f4f3f1; color: #1a1a1a;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  @media (prefers-color-scheme: dark) {
    html, body { background: #1a1a1a; color: #f4f3f1; }
    .card { background: #232323; border-color: #2f2f2f; }
    .muted { color: #b3b3b3; }
    code, .mono { background: #2a2a2a; color: #f4f3f1; }
    .cancel { color: #b3b3b3; }
  }
  main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
  .card { width: 100%; max-width: 28rem; background: #ffffff; border: 1px solid #e7e5e1;
    border-radius: 12px; padding: 1.5rem 1.5rem 1.25rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0.25rem 0; font-size: 0.9375rem; line-height: 1.5; }
  .muted { color: #555; font-size: 0.8125rem; }
  dl { margin: 1rem 0 1.25rem; display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1rem; font-size: 0.875rem; }
  dt { color: #666; }
  dd { margin: 0; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f1efeb; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.8125rem; word-break: break-all; }
  .actions { display: flex; gap: 0.75rem; align-items: center; margin-top: 1rem; }
  button { font: inherit; padding: 0.625rem 1.1rem; border-radius: 8px; border: 1px solid transparent;
    background: #1a1a1a; color: #f4f3f1; cursor: pointer; font-weight: 500; }
  button:hover { opacity: 0.9; }
  .cancel { color: #555; text-decoration: none; font-size: 0.875rem; }
  .cancel:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Authorize ${displayName}</h1>
    <p>${displayName} is requesting read access to your S×C data.</p>
    <dl>
      <dt>Client</dt><dd><span class="mono">${clientId}</span></dd>
      <dt>Scope</dt><dd><span class="mono">${scope}</span></dd>
      <dt>Redirect</dt><dd class="muted"><span class="mono">${redirectUri}</span></dd>
    </dl>
    <p class="muted">If you didn&#39;t initiate this from ${displayName}, cancel and close this tab.</p>
    <form method="POST" action="/mcp/authorize/confirm" class="actions">
      <input type="hidden" name="signed_state" value="${signedState}" />
      <button type="submit">Authorize</button>
      <a href="/app" class="cancel">Cancel</a>
    </form>
  </div>
</main>
</body>
</html>`;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = readQuery(url);
  if (!q)
    return oauthError(
      "invalid_request",
      "response_type=code, client_id, redirect_uri required",
    );

  const client = findAllowedClient(q.clientId);
  if (!client)
    return oauthError(
      "invalid_client",
      `Unknown MCP client_id: ${q.clientId}`,
    );
  if (!isAllowedRedirectUri(client, q.redirectUri))
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uri does not match a known callback for this client.",
    );

  const {
    data: { user },
  } = await getAuthUser();
  if (!user) {
    // Bounce through Supabase Auth and come back. The login page reads
    // ?next= and round-trips us once the session cookie is set.
    const next = `/mcp/authorize?${url.searchParams.toString()}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, url),
    );
  }

  const signedState = signConsentState({
    userId: user.id,
    clientId: q.clientId,
    scope: q.scope,
    redirectUri: q.redirectUri,
    state: q.state,
  });

  const html = renderConsentPage({
    clientDisplayName: client.displayName,
    clientId: q.clientId,
    scope: q.scope,
    redirectUri: q.redirectUri,
    signedState,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Defense-in-depth against any future markup mishap on this page.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    },
  });
}
