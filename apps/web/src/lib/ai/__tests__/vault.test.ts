import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vault helper round-trip. The real implementation calls the
 * SECURITY DEFINER RPCs over a service-role Supabase client; here we
 * mock the client so we can assert the round-trip contract without
 * touching a database.
 */

type RpcArgs = Record<string, unknown>;
const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdmin: () => ({ rpc: rpcMock }),
}));

describe("vault helpers", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    process.env.AI_KEY_ENCRYPTION_KEY = "x".repeat(32);
  });
  afterEach(() => {
    delete process.env.AI_KEY_ENCRYPTION_KEY;
  });

  it("storeByoaiKey calls byoai_store_key and returns the vaultId", async () => {
    const { storeByoaiKey } = await import("../vault");
    const VAULT_ID = "11111111-1111-4111-8111-111111111111";
    rpcMock.mockResolvedValueOnce({ data: VAULT_ID, error: null });
    const r = await storeByoaiKey("user-1", "anthropic", "sk-test-abcdef");
    expect(r.vaultId).toBe(VAULT_ID);
    expect(rpcMock).toHaveBeenCalledWith(
      "byoai_store_key",
      expect.objectContaining({
        p_user_id: "user-1",
        p_plaintext: "sk-test-abcdef",
        p_master_key: expect.any(String),
      }) as RpcArgs,
    );
  });

  it("storeByoaiKey rejects implausibly short plaintext", async () => {
    const { storeByoaiKey } = await import("../vault");
    await expect(
      storeByoaiKey("user-1", "anthropic", "abc"),
    ).rejects.toThrow(/implausibly short/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("storeByoaiKey refuses to run when AI_KEY_ENCRYPTION_KEY is missing", async () => {
    delete process.env.AI_KEY_ENCRYPTION_KEY;
    const { storeByoaiKey } = await import("../vault");
    await expect(
      storeByoaiKey("user-1", "anthropic", "sk-test-abcdef"),
    ).rejects.toThrow(/AI_KEY_ENCRYPTION_KEY/);
  });

  it("decryptByoaiKey returns the recovered plaintext", async () => {
    const { decryptByoaiKey } = await import("../vault");
    rpcMock.mockResolvedValueOnce({ data: "sk-recovered", error: null });
    const r = await decryptByoaiKey("vault-1");
    expect(r).toBe("sk-recovered");
  });

  it("decryptByoaiKey returns null when the RPC yields a non-string", async () => {
    const { decryptByoaiKey } = await import("../vault");
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await decryptByoaiKey("vault-1");
    expect(r).toBeNull();
  });

  it("clearByoaiKey calls byoai_clear_key", async () => {
    const { clearByoaiKey } = await import("../vault");
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await clearByoaiKey("vault-1");
    expect(rpcMock).toHaveBeenCalledWith("byoai_clear_key", {
      p_vault_id: "vault-1",
    });
  });

  it("the vault module does not export a client-callable function returning the key", async () => {
    // Privacy contract: only `decryptByoaiKey` returns the plaintext,
    // and it is called only by the server-side resolver. The module
    // surface is small enough to assert by name — if a future
    // refactor adds a `getKey` / `revealKey` / similar, this fails.
    const mod = await import("../vault");
    expect(Object.keys(mod).sort()).toEqual(
      ["clearByoaiKey", "decryptByoaiKey", "storeByoaiKey"],
    );
  });
});
