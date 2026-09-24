import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTmSuggestion } from "../actions";
import { syncTmSuggestionsForSession } from "../tm-suggestion-sync";
import { getPendingProgramRecommendations } from "@/lib/platform/recommendations-queries";

const mock = vi.hoisted(() => ({ client: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/lib/planner/queries", async (original) => ({
  ...await original<typeof import("@/lib/planner/queries")>(), getActiveBlocks: vi.fn(),
}));
vi.mock("@/lib/platform/edit-context", () => ({ getBlockEditContext: mock.edit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));

const owner = "00000000-0000-4000-8000-000000000001";
const session = "00000000-0000-4000-8000-000000000002";
const block = "00000000-0000-4000-8000-000000000003";
const suggestion = "00000000-0000-4000-8000-000000000004";
const movement = "00000000-0000-4000-8000-000000000005";
let kind: string | null | undefined;
let failBlockRead: boolean;
let reads: string[];
let writes: { table: string; body: Record<string, unknown> }[];

beforeEach(() => {
  kind = "strength";
  failBlockRead = false;
  reads = [];
  writes = [];
  mock.edit.mockResolvedValue(null);
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const table = url.pathname.split("/").at(-1)!;
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        writes.push({ table, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      }
      reads.push(table);
      if (table === "sessions") {
        expect(url.searchParams.get("id")).toBe(`eq.${session}`);
        expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
        return Response.json([{ id: session, user_id: owner, block_id: block, completed_at: "2026-09-14T12:00:00Z" }]);
      }
      if (table === "training_blocks") {
        expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
        expect(url.searchParams.get("id")).toBe(`in.(${block})`);
        return failBlockRead
          ? Response.json({ code: "42501", message: "Read refused" }, { status: 403 })
          : Response.json([{ id: block, archetype: null, notes: "My strength program", status: "active",
            program_id: "tactical-barbell", ...(kind === undefined ? {} : { program_kind: kind }) }]);
      }
      if (table === "tm_suggestions") return Response.json([{
        id: suggestion, user_id: owner, movement_id: movement, current_tm_kg: 90, suggested_tm_kg: 110,
        derived_from_session_id: session, derived_from_set_log_id: null, status: "pending", source: "derived_amrap",
      }]);
      if (table === "training_maxes") return Response.json([{ id: "measurement", tm_percent: null }]);
      if (table === "profiles") return Response.json([{ tm_percent_default: 90 }]);
      if (table === "program_recommendations") return Response.json([{
        id: suggestion, kind: "tm-bump", block_id: block, title: "Review squat loads", detail: "Review the next cycle.",
      }]);
      throw new Error(`Unexpected ${table} read`);
    } },
  }));
});

function input() {
  const form = new FormData();
  form.set("suggestionId", suggestion);
  return form;
}

describe("DC-R6 program-owned TM advice", () => {
  it.each(["strength", "running", "hybrid"])("never generates or accepts an account TM change from a typed %s program", async (programKind) => {
    kind = programKind;
    const client = await mock.client();
    expect(await syncTmSuggestionsForSession(client, owner, session)).toEqual([]);
    expect(reads).toEqual(["sessions", "training_blocks"]);
    expect(await acceptTmSuggestion(input())).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it.each([null, undefined])("retains the existing conversion for a legacy source with kind %s", async (legacyKind) => {
    kind = legacyKind;
    expect(await acceptTmSuggestion(input())).toEqual({ ok: true });
    expect(writes.find((write) => write.table === "training_maxes")?.body).toMatchObject({
      user_id: owner, movement_id: movement, one_rm_kg: 122.5, tm_percent: null,
    });
    expect(writes.some((write) => write.table === "program_instances")).toBe(false);
  });

  it("does not guess when the stored kind or owning block is unreadable", async () => {
    kind = "unknown";
    expect(await acceptTmSuggestion(input())).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
    failBlockRead = true;
    const client = await mock.client();
    await expect(syncTmSuggestionsForSession(client, owner, session)).rejects.toThrow();
    expect(await acceptTmSuggestion(input())).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("uses the existing edit control when available and the exact program otherwise", async () => {
    const client = await mock.client();
    mock.edit.mockResolvedValue({ blockId: block });
    expect((await getPendingProgramRecommendations(client, owner, [block]))[0]?.reviewHref)
      .toBe(`/app/program?edit=${block}`);
    expect(mock.edit).toHaveBeenCalledWith(block);
    mock.edit.mockResolvedValue(null);
    expect((await getPendingProgramRecommendations(client, owner, [block]))[0]?.reviewHref)
      .toBe(`/app/plan?block=${block}`);
    expect(writes).toEqual([]);
  });
});
