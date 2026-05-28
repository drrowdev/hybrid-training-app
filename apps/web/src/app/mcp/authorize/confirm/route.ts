/**
 * POST /mcp/authorize/confirm — consent-form submission handler.
 *
 * ADR 0003 + PR #194 Fix #3. The user has just seen the consent screen
 * rendered by GET /mcp/authorize and clicked "Authorize". This handler:
 *
 *   1. Re-authenticates the user against their Supabase session
 *      (same cookie-based check as the GET).
 *   2. Verifies the `signed_state` HMAC envelope. The signature pins
 *      the userId, so it doubles as the CSRF token — a forged POST
 *      from another origin cannot produce a valid envelope for this
 *      user without the signing key. We also assert the envelope's
 *      `userId` equals the current session's `user.id`.
 *   3. Re-checks the client allowlist and redirect_uri pattern (the
 *      envelope was signed by us so this is belt-and-braces — a
 *      changed allowlist between GET and POST should reject the POST).
 *   4. Mints the authorization code and redirects to
 *      `redirect_uri?code=<code>&state=<state>`.
 */
import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/supabase/server";
import { signAuthCode, verifyConsentState } from "@/lib/ai/mcp/authCodes";
import {
  findAllowedClient,
  isAllowedRedirectUri,
} from "@/lib/ai/mcp/clients";
import { logMcpAuthorization } from "@/lib/ai/mcp/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function readSignedState(req: Request): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const j = (await req.json()) as Record<string, unknown>;
      const v = j["signed_state"];
      return typeof v === "string" ? v : "";
    } catch {
      return "";
    }
  }
  try {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return params.get("signed_state") ?? "";
  } catch {
    return "";
  }
}

export async function POST(req: Request): Promise<Response> {
  const signedState = await readSignedState(req);
  if (!signedState)
    return oauthError("invalid_request", "signed_state is required.");

  const consent = verifyConsentState(signedState);
  if (!consent)
    return oauthError(
      "invalid_request",
      "Consent state invalid or expired. Restart the authorization flow.",
    );

  const {
    data: { user },
  } = await getAuthUser();
  if (!user)
    return oauthError(
      "invalid_request",
      "Not signed in. Restart the authorization flow.",
      401,
    );

  if (user.id !== consent.userId)
    return oauthError(
      "invalid_request",
      "Consent state does not match the signed-in user.",
      403,
    );

  // Belt-and-braces: re-check the allowlist + redirect_uri pattern.
  const client = findAllowedClient(consent.clientId);
  if (!client) return oauthError("invalid_client", "Unknown MCP client_id.");
  if (!isAllowedRedirectUri(client, consent.redirectUri))
    return oauthError(
      "invalid_redirect_uri",
      "redirect_uri does not match a known callback for this client.",
    );

  const code = signAuthCode({
    userId: consent.userId,
    clientId: consent.clientId,
    scope: consent.scope,
    redirectUri: consent.redirectUri,
  });

  await logMcpAuthorization({
    userId: consent.userId,
    clientId: consent.clientId,
    event: "authorize",
    scope: consent.scope,
  });

  const redirect = new URL(consent.redirectUri);
  redirect.searchParams.set("code", code);
  if (consent.state) redirect.searchParams.set("state", consent.state);
  return NextResponse.redirect(redirect, { status: 302 });
}
