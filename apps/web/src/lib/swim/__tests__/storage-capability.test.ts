import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSwimCapability, requireSwimSetup, requireSwimStorage, swimSchemaAvailable } from "../capability";

const client = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as unknown as SupabaseClient;

afterEach(() => vi.unstubAllEnvs());

describe("ADR0079 additive swim capability", () => {
  it("disables only the setup entry point when its rollout gate is off", async () => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "false");
    const db = client(true);
    expect(await getSwimCapability(db)).toEqual({
      storageAvailable: true,
      setupEnabled: false,
    });
    await expect(requireSwimStorage(db)).resolves.toBeUndefined();
    expect(await swimSchemaAvailable(db)).toBe(true);
    await expect(requireSwimSetup(db)).rejects.toThrow();
  });

  it("enables setup only for an exact true gate and installed storage", async () => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "true");
    expect((await getSwimCapability(client(true))).setupEnabled).toBe(true);
    vi.stubEnv("POOL_SWIMMING_ENABLED", "TRUE");
    expect((await getSwimCapability(client(true))).setupEnabled).toBe(false);
  });

  it.each(["PGRST202", "42883"])("classifies missing RPC %s without a generic fallback", async (code) => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "true");
    const db = client(null, { code, message: "Function missing" });
    expect(await getSwimCapability(db)).toEqual({
      storageAvailable: false,
      setupEnabled: false,
    });
    await expect(requireSwimStorage(db)).rejects.toThrow();
    expect(await swimSchemaAvailable(db)).toBe(false);
  });

  it.each(["42501", "PGRST301", "XX000", "42P01"])("does not swallow %s", async (code) => {
    await expect(getSwimCapability(client(null, { code, message: "Failure" }))).rejects.toThrow();
    await expect(swimSchemaAvailable(client(null, { code, message: "Failure" }))).rejects.toThrow();
  });

  it("fails loud on malformed responses and transport failures", async () => {
    await expect(getSwimCapability(client(null))).rejects.toThrow();
    const db = { rpc: vi.fn().mockRejectedValue(new Error("Network")) } as unknown as SupabaseClient;
    await expect(getSwimCapability(db)).rejects.toThrow("Network");
  });
});
