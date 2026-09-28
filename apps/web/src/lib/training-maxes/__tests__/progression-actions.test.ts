import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptMaxSuggestions, declineMaxSuggestions, setScheduledMaxProgression } from "../progression-actions";

const mock = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));
const first = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
let requests: { endpoint: string; body: unknown }[];
let error: { code: string; message: string } | null;

beforeEach(() => {
  requests = [];
  error = null;
  mock.revalidate.mockReset();
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.pathname).toContain("/rpc/");
      requests.push({ endpoint: url.pathname.split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
      return error ? Response.json(error, { status: 400 }) : Response.json(2);
    } },
  }));
});
const form = (ids: string[]) => {
  const value = new FormData();
  for (const id of ids) value.append("suggestionId", id);
  return value;
};

describe("max decision server boundary", () => {
  it.each([true, false])("sends single/bulk decisions to one atomic owner-scoped RPC (accept=%s)", async (accept) => {
    const action = accept ? acceptMaxSuggestions : declineMaxSuggestions;
    expect(await action(form([first, second]))).toEqual({ ok: true });
    expect(requests).toEqual([{ endpoint: "decide_max_suggestions", body: { p_ids: [first, second], p_accept: accept } }]);
    expect(mock.revalidate.mock.calls.map(([route]) => route)).toEqual(["/app", "/app/settings/training-maxes", "/app/plan"]);
  });
  it.each([{ ids: [] }, { ids: ["bad"] }, { ids: [first, first] }])("rejects empty, malformed or repeated IDs without writing ($ids)", async ({ ids }) => {
    expect(await acceptMaxSuggestions(form(ids))).toMatchObject({ ok: false });
    expect(requests).toEqual([]);
  });
  it("never falls back to non-atomic writes if 0161 is unavailable", async () => {
    error = { code: "PGRST202", message: "Could not find decide_max_suggestions" };
    expect(await acceptMaxSuggestions(form([first]))).toMatchObject({ ok: false });
    expect(requests).toHaveLength(1);
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it("returns stale-decision errors without claiming success", async () => {
    error = { code: "40001", message: "This max has changed. Reload Today." };
    expect(await declineMaxSuggestions(form([first]))).toEqual({ ok: false, error: error.message });
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it("updates only the preference key through its atomic RPC", async () => {
    const value = new FormData();
    value.set("enabled", "false");
    expect(await setScheduledMaxProgression(value)).toEqual({ ok: true });
    expect(requests).toEqual([{ endpoint: "set_scheduled_max_progression", body: { p_enabled: false } }]);
  });
});
