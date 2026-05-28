/**
 * POST /mcp/token — OAuth 2.1 token endpoint.
 *
 * Exchanges a one-time authorization code (issued by /mcp/authorize)
 * for a 1-hour bearer access token. ADR 0003 §"OAuth 2.1 + Supabase
 * Auth bridge".
 *
 * No refresh tokens in v1 — the user re-authorises when their access
 * token expires.
 *
 * The endpoint accepts both standard form-encoded and JSON bodies
 * since MCP hosts differ in how they POST the exchange.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { mintMcpToken, MCP_TOKEN_LIFETIME_SECONDS } from "@/lib/ai/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthCodePayload = {
  userId: string;
  clientId: string;
  scope: string;
  redirectUri: string;
  iat: number;
  exp: number;
};

function verifyCode(code: string): AuthCodePayload | null {
  const key = process.env.MCP_TOKEN_SIGNING_KEY ?? "";
  if (!key) return null;
  const dot = code.indexOf(".");
  if (dot <= 0) return null;
  const body = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  let parsed: AuthCodePayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as AuthCodePayload;
  } catch {
    return null;
  }
  if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
  return parsed;
}

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

export async function POST(req: Request): Promise<Response> {
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

  const payload = verifyCode(code);
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
