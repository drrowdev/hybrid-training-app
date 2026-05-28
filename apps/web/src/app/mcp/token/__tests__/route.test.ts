/**
 * /mcp/token route tests — PR #194 follow-up.
 *
 * Covers the two new security gates added in response to the code
 * review on PR A:
 *
 *   - replay-rejection: redeeming the same authorization code twice
 *     succeeds the first time and returns invalid_grant the second
 *     (Fix #2 — single-use codes).
 *   - consent-state-tamper-rejection (lives next door under the
 *     /mcp/authorize/confirm path, but exercised through the same
 *     authCodes module): a mutated signed envelope fails verification.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConsumedCodeStore } from "@/lib/ai/mcp/consumedCodes";

const ORIGINAL_KEY = process.env.MCP_TOKEN_SIGNING_KEY;

function inMemoryConsumedCodes(): ConsumedCodeStore {
  const seen = new Set<string>();
  return {
    async markCodeConsumed(hash: string) {
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    },
  };
}

function formBody(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request("https://x.test/mcp/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /mcp/token", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_SIGNING_KEY =
      "test-test-test-test-test-test-test-test-test-key";
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.MCP_TOKEN_SIGNING_KEY;
    else process.env.MCP_TOKEN_SIGNING_KEY = ORIGINAL_KEY;
  });

  it("rejects an already-redeemed authorization code (single-use)", async () => {
    const { signAuthCode } = await import("@/lib/ai/mcp/authCodes");
    const { handleTokenRequest } = await import("../route");

    const clientId = "claude-web";
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const code = signAuthCode({
      userId: "user-1",
      clientId,
      scope: "tools:read",
      redirectUri,
    });

    const consumedCodes = inMemoryConsumedCodes();

    const first = await handleTokenRequest(
      formBody({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
      }),
      { consumedCodes },
    );
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { access_token?: string };
    expect(typeof firstJson.access_token).toBe("string");

    const second = await handleTokenRequest(
      formBody({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
      }),
      { consumedCodes },
    );
    expect(second.status).toBe(400);
    const secondJson = (await second.json()) as {
      error?: string;
      error_description?: string;
    };
    expect(secondJson.error).toBe("invalid_grant");
    expect(secondJson.error_description).toMatch(/already used/i);
  });

  it("rejects a tampered consent-state envelope (Fix #3 boundary)", async () => {
    const { signConsentState, verifyConsentState } = await import(
      "@/lib/ai/mcp/authCodes"
    );
    const signed = signConsentState({
      userId: "user-1",
      clientId: "claude-web",
      scope: "tools:read",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      state: "xyz",
    });
    // Mutate the body half of `<body>.<sig>` so the HMAC no longer
    // matches. A real attacker could try to swap clientId/redirectUri
    // between the GET (consent render) and the POST (confirm).
    const dot = signed.indexOf(".");
    const tampered = signed.slice(0, dot - 2) + "AA." + signed.slice(dot + 1);
    expect(verifyConsentState(tampered)).toBeNull();
  });

  it("rejects an unknown client_id with invalid_client", async () => {
    const { signAuthCode } = await import("@/lib/ai/mcp/authCodes");
    const { handleTokenRequest } = await import("../route");
    const code = signAuthCode({
      userId: "user-1",
      clientId: "not-a-real-client",
      scope: "tools:read",
      redirectUri: "https://evil.example.com/cb",
    });
    const res = await handleTokenRequest(
      formBody({
        grant_type: "authorization_code",
        code,
        client_id: "not-a-real-client",
        redirect_uri: "https://evil.example.com/cb",
      }),
      { consumedCodes: inMemoryConsumedCodes() },
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("invalid_client");
  });
});
