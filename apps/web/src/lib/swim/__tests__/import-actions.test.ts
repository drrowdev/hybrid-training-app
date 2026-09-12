import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportStorageAvailable } from "../import-storage";
import { connectSwimDashboard, disconnectSwimDashboard } from "../import-actions";
import { hashSwimImportKey, makeSwimImportKey, swimImportBearer } from "../import-key";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("../import-storage", () => ({ swimImportStorageAvailable: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWIM_IMPORT_ENABLED", "true");
  vi.mocked(getAuthUser).mockResolvedValue({ data: { user: { id } }, error: null } as never);
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  vi.mocked(swimImportStorageAvailable).mockResolvedValue(true);
  rpc.mockResolvedValue({ data: id, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW8 connection ownership boundary", () => {
  it("creates random narrow keys and sends only their hash to storage", async () => {
    const first = await connectSwimDashboard();
    const second = makeSwimImportKey();
    if (!first.ok) throw new Error("Synthetic connection failed");
    expect(first.key).not.toBe(second);
    expect(swimImportBearer(`Bearer ${first.key}`)).toBe(first.key);
    expect(hashSwimImportKey(first.key)).toMatch(/^[a-f0-9]{64}$/);
    expect(rpc).toHaveBeenCalledWith("swim_import_connect", { p_hash: hashSwimImportKey(first.key) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(first.key);
  });
  it("requires a signed-in account", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    expect((await connectSwimDashboard()).ok).toBe(false);
    expect((await disconnectSwimDashboard(id)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("cannot connect before rollout or migration", async () => {
    vi.stubEnv("SWIM_IMPORT_ENABLED", "");
    expect((await connectSwimDashboard()).ok).toBe(false);
    vi.stubEnv("SWIM_IMPORT_ENABLED", "true");
    vi.mocked(swimImportStorageAvailable).mockResolvedValue(false);
    expect((await connectSwimDashboard()).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not silently replace an existing connection or expose its key", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "SYNTHETIC_PRIVATE" } });
    const result = await connectSwimDashboard();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("key");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("allows disconnect when new imports are disabled", async () => {
    vi.stubEnv("SWIM_IMPORT_ENABLED", "false");
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await disconnectSwimDashboard(id)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("swim_import_disconnect", { p_id: id });
  });
  it("rejects invalid and foreign connection requests", async () => {
    expect((await disconnectSwimDashboard("not-an-id")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "SYNTHETIC_PRIVATE" } });
    expect((await disconnectSwimDashboard(id)).ok).toBe(false);
  });
});
