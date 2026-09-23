import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
  getAuthUser: async () => ({ data: { user: { id: owner } } }),
}));
import { removeSeasonBlock, updateSeasonBlock } from "../actions";

const owner = "00000000-0000-4000-8000-000000000001";
const blockId = "00000000-0000-4000-8000-000000000002";
let writes: { method: string; url: URL }[];
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    if (method === "GET") {
      expect(url.pathname).toMatch(/season_blocks$/);
      expect(url.searchParams.get("id")).toBe(`eq.${blockId}`);
      return Response.json({ season_id: "00000000-0000-4000-8000-000000000003", status: "planned" });
    }
    writes.push({ method, url });
    return Response.json([]);
  } },
});
beforeEach(() => { writes = []; revalidatePath.mockReset(); });

describe("DC-R5 roadmap edits racing activation", () => {
  it.each(["edit", "remove"])("refuses a %s when the planned slot was activated before the write", async (operation) => {
    const result = operation === "edit"
      ? await updateSeasonBlock({ blockId, intentNote: "Retain this draft" })
      : await removeSeasonBlock({ blockId });
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe(operation === "edit" ? "PATCH" : "DELETE");
    expect(writes[0]!.url.searchParams.get("status")).toBe("eq.planned");
    expect(writes[0]!.url.searchParams.get("id")).toBe(`eq.${blockId}`);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
