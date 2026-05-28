/**
 * POST /mcp/token — OAuth 2.1 token endpoint.
 *
 * Exchanges a one-time authorization code (issued by
 * /mcp/authorize/confirm) for a 1-hour bearer access token. ADR 0003
 * §"OAuth 2.1 + Supabase Auth bridge".
 *
 * PR #194 code-review fixes:
 *   - Fix #1: signing key is enforced via the shared
 *     `verifyAuthCode()` helper (which uses `requireSigningKey()`).
 *     No more silent `?? ""` fallback that could let an attacker forge
 *     codes against an empty key.
 *   - Fix #2: authorization codes are single-use. After signature
 *     verification we atomically INSERT a SHA-256 of the code into
 *     `mcp_consumed_codes`; a duplicate insert (= replay) returns
 *     `invalid_grant`.
 *   - Fix #4 (bonus): redeemed codes are validated against the
 *     `ALLOWED_MCP_CLIENTS` allowlist and the client's redirect_uri
 *     pattern, matching the /authorize gate.
 *
 * No refresh tokens in v1 — the user re-authorises when their access
 * token expires.
 *
 * The endpoint accepts both standard form-encoded and JSON bodies
 * since MCP hosts differ in how they POST the exchange.
 */
import { NextResponse } from "next/server";

import { mintMcpToken, MCP_TOKEN_LIFETIME_SECONDS } from "@/lib/ai/mcp/auth";
import { verifyAuthCode } from "@/lib/ai/mcp/authCodes";
import {
  defaultConsumedCodeStore,
  hashAuthCode,
  type ConsumedCodeStore,
} from "@/lib/ai/mcp/consumedCodes";
import {
  findAllowedClient,
  isAllowedRedirectUri,
} from "@/lib/ai/mcp/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const j = (await req.json()) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }
  // application/x-www-form-urlencoded (the OAuth 2.1 default)
  try {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  } catch {
    return {};
  }
}

function tokenError(
  status: number,
  error: string,
  description: string,
): Response {
  return NextResponse.json(
    { error, error_description: description },
    { status },
  );
}

export type TokenRouteDeps = {
  consumedCodes?: ConsumedCodeStore;
};

/**
 * Pure handler exported for unit tests so they can inject a fake
 * `ConsumedCodeStore` without spinning up Supabase. The default `POST`
 * export wraps this with the production dependencies.
 */
export async function handleTokenRequest(
  req: Request,
  deps: TokenRouteDeps = {},
): Promise<Response> {
  const consumedCodes = deps.consumedCodes ?? defaultConsumedCodeStore;

  const body = await readBody(req);
  const grantType = body.grant_type ?? "";
  if (grantType !== "authorization_code") {
    return tokenError(
      400,
      "unsupported_grant_type",
      "Only grant_type=authorization_code is supported in v1.",
    );
  }
  const code = body.code ?? "";
  const clientId = body.client_id ?? "";
  const redirectUri = body.redirect_uri ?? "";
  if (!code || !clientId || !redirectUri) {
    return tokenError(
      400,
      "invalid_request",
      "code, client_id, and redirect_uri are required.",
    );
  }

  const payload = verifyAuthCode(code);
  if (!payload) {
    return tokenError(400, "invalid_grant", "Authorization code invalid or expired.");
  }
  if (payload.clientId !== clientId || payload.redirectUri !== redirectUri) {
    return tokenError(
      400,
      "invalid_grant",
      "client_id / redirect_uri mismatch.",
    );
  }

  // Belt-and-braces: redeemed codes were issued under the allowlist
  // gate at /authorize, but re-check here so a code minted before an
  // allowlist tightening can never be redeemed afterwards.
  const allowed = findAllowedClient(payload.clientId);
  if (!allowed)
    return tokenError(400, "invalid_client", "Unknown MCP client_id.");
  if (!isAllowedRedirectUri(allowed, payload.redirectUri))
    return tokenError(
      400,
      "invalid_redirect_uri",
      "redirect_uri does not match a known callback for this client.",
    );

  // Fix #2 — single-use enforcement. INSERT the SHA-256 of the code
  // into `mcp_consumed_codes`; a duplicate (= already redeemed) flips
  // `inserted` to false and we reject the exchange.
  const codeHash = hashAuthCode(code);
  let inserted = false;
  try {
    inserted = await consumedCodes.markCodeConsumed(codeHash);
  } catch (err) {
    console.warn("mcp/token: consumed-codes insert failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return tokenError(
      500,
      "server_error",
      "Could not record code redemption. Please retry the authorization flow.",
    );
  }
  if (!inserted) {
    return tokenError(
      400,
      "invalid_grant",
      "Authorization code already used.",
    );
  }

  const { token, expiresAt } = mintMcpToken({
    userId: payload.userId,
    clientId: payload.clientId,
    scope: payload.scope,
  });

  return NextResponse.json(
    {
      access_token: token,
      token_type: "Bearer",
      expires_in: MCP_TOKEN_LIFETIME_SECONDS,
      scope: payload.scope,
      // exp surfaced for easier client-side caching diagnostics.
      exp: expiresAt,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  return handleTokenRequest(req);
}
