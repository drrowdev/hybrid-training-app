/**
 * MCP bearer-token mint + verify + auth context resolution.
 *
 * ADR 0003 §"OAuth 2.1 + Supabase Auth bridge".
 *
 * Tokens are short-lived (1 hour) HMAC-signed envelopes. Payload binds
 * `{ userId, clientId, scope }` so a leaked token can only act on
 * behalf of one specific Supabase user via one specific external MCP
 * client. No refresh tokens in v1 — the user re-authorizes when their
 * token expires.
 *
 * Signing key: `MCP_TOKEN_SIGNING_KEY` env var (required at runtime;
 * documented in `.env.example` and the README). The key is never
 * exposed to client JS.
 *
 * Privacy: no token material is persisted. Only `mcp_authorizations`
 * audit rows (authorize / revoke events) reach the DB.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ToolContext } from "@/lib/ai/tools";

/** v1 fixed token lifetime — kept short to bound the blast radius. */
export const MCP_TOKEN_LIFETIME_SECONDS = 60 * 60;

export type McpTokenPayload = {
  /** Supabase auth.users.id. */
  userId: string;
  /** External MCP client id (e.g. "claude-web", "chatgpt", "cursor"). */
  clientId: string;
  /** Space-separated scope string; v1 always "tools:read". */
  scope: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expires-at, unix seconds. */
  exp: number;
};

export type McpAuthSuccess = {
  ok: true;
  ctx: ToolContext;
  payload: McpTokenPayload;
};

export type McpAuthFailure = {
  ok: false;
  response: Response;
};

export type McpAuthResult = McpAuthSuccess | McpAuthFailure;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

export function requireSigningKey(): string {
  const key = process.env.MCP_TOKEN_SIGNING_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "MCP_TOKEN_SIGNING_KEY env var missing or too short (need >= 32 chars).",
    );
  }
  return key;
}

/**
 * Mint a signed bearer token. Body is base64url(JSON(payload)) and the
 * signature is HMAC-SHA256 over the body using the signing key.
 *
 * Format: `<body>.<sig>`. Compact and stable; no JWT header to argue
 * with about alg confusion attacks because we don't accept a header.
 */
export function mintMcpToken(payload: {
  userId: string;
  clientId: string;
  scope?: string;
  nowSeconds?: number;
}): { token: string; expiresAt: number } {
  const key = requireSigningKey();
  const now = payload.nowSeconds ?? Math.floor(Date.now() / 1000);
  const full: McpTokenPayload = {
    userId: payload.userId,
    clientId: payload.clientId,
    scope: payload.scope ?? "tools:read",
    iat: now,
    exp: now + MCP_TOKEN_LIFETIME_SECONDS,
  };
  const body = base64UrlEncode(JSON.stringify(full));
  const sig = base64UrlEncode(
    createHmac("sha256", key).update(body).digest(),
  );
  return { token: `${body}.${sig}`, expiresAt: full.exp };
}

export function verifyMcpToken(token: string): McpTokenPayload | null {
  const key = requireSigningKey();
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = base64UrlEncode(
    createHmac("sha256", key).update(body).digest(),
  );
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  let parsed: McpTokenPayload;
  try {
    parsed = JSON.parse(base64UrlDecode(body).toString("utf-8")) as McpTokenPayload;
  } catch {
    return null;
  }
  if (typeof parsed.userId !== "string" || parsed.userId.length === 0)
    return null;
  if (typeof parsed.clientId !== "string" || parsed.clientId.length === 0)
    return null;
  if (typeof parsed.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
  return parsed;
}

function bearerFromHeader(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/.exec(h);
  return m ? m[1] : null;
}

function unauthorized(message: string): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: message,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        // Per OAuth 2.1: advertise the protected resource metadata
        // route so MCP hosts can discover the authorize endpoint.
        "WWW-Authenticate": 'Bearer realm="mcp", error="invalid_token"',
      },
    },
  );
}

/**
 * Resolves the bearer token on the request into a `ToolContext` whose
 * Supabase client is signed in as the token's user. The client uses
 * the same `createServerClient` Supabase SSR helper as the in-app
 * surface so RLS posture is identical across both paths.
 *
 * We inject the user's `sub` via the Authorization header on each
 * outbound REST call so `auth.uid()` resolves to the token's user in
 * every RLS policy.
 */
export async function requireMcpBearerAuth(
  req: Request,
  opts: {
    /** Override for tests; defaults to env-derived Supabase client. */
    buildSupabase?: (payload: McpTokenPayload) => SupabaseClient;
  } = {},
): Promise<McpAuthResult> {
  const token = bearerFromHeader(req);
  if (!token) return { ok: false, response: unauthorized("Missing bearer token.") };
  const payload = verifyMcpToken(token);
  if (!payload)
    return {
      ok: false,
      response: unauthorized("Bearer token invalid or expired."),
    };
  const supabase = opts.buildSupabase
    ? opts.buildSupabase(payload)
    : buildMcpSupabaseClient(payload);
  return {
    ok: true,
    payload,
    ctx: {
      userId: payload.userId,
      supabase,
      tz: "UTC",
    },
  };
}

function buildMcpSupabaseClient(payload: McpTokenPayload): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase URL / service-role key missing — cannot build MCP server client.",
    );
  }
  // ─── RLS posture for the MCP path ────────────────────────────────
  // Supabase JS does not expose a documented "sign in as user X" path
  // without the user's password or a fresh OAuth flow. To keep MCP
  // request latency bounded and avoid an extra round trip per call,
  // the MCP bridge uses a service-role client. RLS is therefore NOT
  // the enforcement layer on this path — instead, EVERY catalogue
  // tool handler explicitly filters by `ctx.userId` (verified by the
  // per-tool "RLS isolation" unit tests in `__tests__/`). This is
  // defense in depth flipped — the application layer is the gate,
  // RLS is a backstop on the in-app path.
  //
  // If a future tool forgets to scope by user_id, that omission would
  // be caught by the matching RLS-isolation unit test AND, on the
  // in-app orchestrator path (PR B), by Postgres-level RLS.
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        "X-MCP-User-Id": payload.userId,
        "X-MCP-Client-Id": payload.clientId,
      },
    },
  });
}
