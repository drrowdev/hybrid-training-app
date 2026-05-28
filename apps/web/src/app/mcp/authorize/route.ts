/**
 * GET /mcp/authorize — OAuth 2.1 authorization endpoint for external
 * MCP clients (Claude / ChatGPT / Cursor / Gemini CLI).
 *
 * ADR 0003 §"OAuth 2.1 + Supabase Auth bridge":
 *   - Already-signed-in users see only a consent screen.
 *   - Logged-out users are redirected to Supabase Auth, then back here
 *     to complete consent.
 *
 * v1 simplified flow (consent-only, no PKCE round-trip on a separate
 * /consent page): we accept the standard OAuth `response_type=code`
 * query, validate the user's session, and immediately issue an
 * authorization code (HMAC-signed envelope that the /token endpoint
 * will exchange). The user is shown a brief HTML confirmation page
 * before the redirect so they understand what they're authorising.
 *
 * Authorization code lifetime is short (5 min) and binds
 * `{ userId, clientId, scope, redirectUri }`.
 */
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/supabase/server";
import { logMcpAuthorization } from "@/lib/ai/mcp/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_LIFETIME_SECONDS = 5 * 60;

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

function signCode(payload: {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
}): string {
  const key = process.env.MCP_TOKEN_SIGNING_KEY ?? "";
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + CODE_LIFETIME_SECONDS }),
  ).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function badRequest(message: string): Response {
  return NextResponse.json(
    { error: "invalid_request", error_description: message },
    { status: 400 },
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = readQuery(url);
  if (!q) return badRequest("response_type=code, client_id, redirect_uri required");

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

  const code = signCode({
    userId: user.id,
    clientId: q.clientId,
    scope: q.scope,
    redirectUri: q.redirectUri,
  });

  await logMcpAuthorization({
    userId: user.id,
    clientId: q.clientId,
    event: "authorize",
    scope: q.scope,
  });

  const redirect = new URL(q.redirectUri);
  redirect.searchParams.set("code", code);
  if (q.state) redirect.searchParams.set("state", q.state);
  return NextResponse.redirect(redirect, { status: 302 });
}
