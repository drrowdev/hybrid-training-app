import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertTrainingMax } from "../actions";

const mock = vi.hoisted(() => ({ client: vi.fn(), blocks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/lib/planner/queries", () => ({ getActiveBlocks: mock.blocks }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Unexpected redirect"); } }));

const owner = "00000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
type Measurement = {
  user_id: string;
  movement_id: string;
  one_rm_kg: number;
  tm_percent: number | null;
  source: string;
};
let rows: Measurement[];
let requests: { url: URL; method: string }[];
let writes: Measurement[];
let readError: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    { user_id: owner, movement_id: first, one_rm_kg: 100, tm_percent: null, source: "entered" },
    { user_id: owner, movement_id: second, one_rm_kg: 80, tm_percent: 85, source: "derived_amrap" },
  ];
  requests = [];
  writes = [];
  readError = false;
  mock.blocks.mockResolvedValue([
    { id: "strength", programKind: "strength" }, { id: "hybrid", programKind: "hybrid" },
  ]);
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      const table = url.pathname.split("/").at(-1);
      if (table === "training_maxes") {
        if (method === "POST") {
          const body: Measurement = JSON.parse(String(init?.body));
          if (body.user_id !== owner) throw new Error("Foreign measurement write");
          writes.push(body);
          rows = rows.filter((row) => row.movement_id !== body.movement_id).concat(body);
          return new Response(null, { status: 201 });
        }
        if (method !== "GET") throw new Error("Unexpected measurement mutation");
        if (readError) return Response.json({ code: "42501", message: "Read refused" }, { status: 403 });
        return Response.json(rows.filter((row) =>
          url.searchParams.get("user_id") === `eq.${row.user_id}` &&
          url.searchParams.get("movement_id") === `eq.${row.movement_id}`));
      }
      if (table === "program_instances" && method === "GET") {
        if (url.searchParams.get("user_id") !== `eq.${owner}` || url.searchParams.get("block_id") !== "eq.legacy") {
          return Response.json({ code: "PGRST116", message: "More than one active instance" }, { status: 406 });
        }
        return Response.json([{ program_family: "tactical-barbell", instance: { useTrainingMax: false } }]);
      }
      throw new Error("Unexpected table access");
    } },
  }));
});

function input(movementId = first, oneRmKg = 110) {
  const form = new FormData();
  form.set("movementId", movementId);
  form.set("oneRmKg", String(oneRmKg));
  return form;
}

describe("DC-R6 shared strength measurements", () => {
  it("edits one measurement with concurrent typed programs without borrowing either program's percentage", async () => {
    const other = structuredClone(rows[1]);
    expect(await upsertTrainingMax(input())).toEqual({ ok: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ movement_id: first, one_rm_kg: 110, tm_percent: null });
    expect(rows.find((row) => row.movement_id === second)).toEqual(other);
    expect(requests.every((request) => request.url.pathname.endsWith("/training_maxes"))).toBe(true);
  });

  it("retains an existing legacy percentage without consulting an active program", async () => {
    expect(await upsertTrainingMax(input(second, 85))).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ movement_id: second, tm_percent: 85 });
    expect(mock.blocks).not.toHaveBeenCalled();
  });

  it("keeps new measurements account-owned when there is no program", async () => {
    rows = [];
    mock.blocks.mockResolvedValue([]);
    expect(await upsertTrainingMax(input())).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ movement_id: first, one_rm_kg: 110, tm_percent: null });
  });

  it("scopes legacy compatibility to the exact owning block", async () => {
    mock.blocks.mockResolvedValue([{ id: "legacy", programKind: null }]);
    expect(await upsertTrainingMax(input())).toEqual({ ok: true });
    expect(writes[0]?.tm_percent).toBe(100);
    const query = requests.find((request) => request.url.pathname.endsWith("/program_instances"))!.url;
    expect(query.searchParams.get("block_id")).toBe("eq.legacy");
    expect(query.searchParams.get("status")).toBe("eq.active");
    expect(query.searchParams.get("deleted_at")).toBe("is.null");
  });

  it("does not overwrite a measurement after a read error", async () => {
    readError = true;
    expect(await upsertTrainingMax(input())).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("reports unreadable ownership instead of choosing an arbitrary program", async () => {
    mock.blocks.mockRejectedValue(new Error("Ambiguous owners"));
    expect(await upsertTrainingMax(input())).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });
});
