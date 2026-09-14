import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSwimImports, swimImportStorageAvailable } from "../import-storage";

const id = "11111111-1111-4111-8111-111111111111";
function fixture(data: unknown = true, error: unknown = null) {
  const filters: unknown[] = [];
  const results: Record<string, { data: unknown; error: unknown }> = {
    swim_connections: { data: [{ id, created_at: "2026-09-12", revoked_at: null }], error: null },
    swim_imports: { data: [], error: null },
  };
  const from = vi.fn((table: string) => ({
    select(columns: string) {
      filters.push([table, "select", columns]);
      return {
        eq(column: string, value: string) {
          filters.push([table, "eq", column, value]);
          return {
            order() { return { limit(limit: number) { filters.push([table, "limit", limit]); return results[table]; } }; },
          };
        },
      };
    },
  }));
  const client = { from, rpc: vi.fn(() => ({ abortSignal: vi.fn(async () => ({ data, error })) })) };
  return { client: client as unknown as SupabaseClient, from, filters, results };
}
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW8 import visibility and rollout", () => {
  it("does not query uninstalled tables", async () => {
    const f = fixture(null, { code: "PGRST202" });
    expect(await loadSwimImports(f.client, id)).toEqual({ available: false, enabled: false, connections: [], imports: [] });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("does not conceal errors as missing storage", async () => {
    await expect(swimImportStorageAvailable(fixture(null, { code: "42501" }).client)).rejects.toThrow();
    await expect(swimImportStorageAvailable(fixture(false).client)).rejects.toThrow();
  });
  it("keeps history and disconnect metadata visible with new imports disabled", async () => {
    vi.stubEnv("SWIM_IMPORT_ENABLED", "false");
    const f = fixture();
    const result = await loadSwimImports(f.client, id);
    expect(result.enabled).toBe(false);
    expect(result.connections).toHaveLength(1);
    expect(f.filters).toEqual([
      ["swim_connections", "select", "id,created_at,revoked_at"],
      ["swim_connections", "eq", "user_id", id],
      ["swim_connections", "limit", 20],
      ["swim_imports", "select", "id,activity_id,revision,evidence,received_at"],
      ["swim_imports", "eq", "user_id", id],
      ["swim_imports", "limit", 50],
    ]);
  });
  it("fails visibly on unreadable or malformed history without revealing source content", async () => {
    const f = fixture();
    f.results.swim_imports = { data: null, error: { message: "SYNTHETIC_PRIVATE" } };
    await expect(loadSwimImports(f.client, id)).rejects.toThrow("Swimming imports could not be loaded.");
    f.results.swim_imports = { data: [{ evidence: "SYNTHETIC_PRIVATE" }], error: null };
    await expect(loadSwimImports(f.client, id)).rejects.toThrow("Swimming imports returned an invalid response.");
  });
});
