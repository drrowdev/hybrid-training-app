import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL_KEY = process.env.MCP_TOKEN_SIGNING_KEY;

describe("MCP bearer-token auth", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_SIGNING_KEY =
      "test-test-test-test-test-test-test-test-test-key";
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.MCP_TOKEN_SIGNING_KEY;
    else process.env.MCP_TOKEN_SIGNING_KEY = ORIGINAL_KEY;
  });

  it("mints a token whose payload round-trips through verify", async () => {
    const { mintMcpToken, verifyMcpToken } = await import("../auth");
    const { token, expiresAt } = mintMcpToken({
      userId: "user-1",
      clientId: "claude-web",
    });
    const payload = verifyMcpToken(token);
    expect(payload?.userId).toBe("user-1");
    expect(payload?.clientId).toBe("claude-web");
    expect(payload?.scope).toBe("tools:read");
    expect(payload?.exp).toBe(expiresAt);
  });

  it("rejects a tampered token", async () => {
    const { mintMcpToken, verifyMcpToken } = await import("../auth");
    const { token } = mintMcpToken({ userId: "u", clientId: "c" });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifyMcpToken(tampered)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { mintMcpToken, verifyMcpToken } = await import("../auth");
    const { token } = mintMcpToken({
      userId: "u",
      clientId: "c",
      nowSeconds: Math.floor(Date.now() / 1000) - 7200,
    });
    expect(verifyMcpToken(token)).toBeNull();
  });

  it("requireMcpBearerAuth returns 401 when Authorization is missing", async () => {
    const { requireMcpBearerAuth } = await import("../auth");
    const r = await requireMcpBearerAuth(new Request("https://x.test/mcp"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
    }
  });

  it("requireMcpBearerAuth returns ctx with the token's userId on success", async () => {
    const { mintMcpToken, requireMcpBearerAuth } = await import("../auth");
    const { token } = mintMcpToken({ userId: "user-7", clientId: "cursor" });
    const r = await requireMcpBearerAuth(
      new Request("https://x.test/mcp", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { buildSupabase: () => ({}) as never },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.userId).toBe("user-7");
      expect(r.payload.clientId).toBe("cursor");
    }
  });
});