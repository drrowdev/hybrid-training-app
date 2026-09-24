import { createClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { swapPlannedMovement } from "../planned-movement-actions";

const mock = vi.hoisted(() => ({ client: vi.fn() }));
const owner = "00000000-0000-4000-8000-000000000001";
const plannedId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const originalId = "00000000-0000-4000-8000-000000000004";
const replacementId = "00000000-0000-4000-8000-000000000005";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));

let prescription: Prescription;
let linkedSessionId: string | null;
let startBeforeWrite: boolean;
let updates: Prescription[];
let requests: { url: URL; method: string }[];

beforeEach(() => {
  const basis = { version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 };
  prescription = { items: [
    { movementId: originalId, kind: "warmup", sets: 1, reps: 5, percentTm: 40, meta: { programLoadBasis: basis } },
    { movementId: originalId, kind: "main", sets: 1, reps: 5, percentTm: 80, meta: { programLoadBasis: basis } },
  ] };
  linkedSessionId = null;
  startBeforeWrite = false;
  updates = [];
  requests = [];
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      const table = url.pathname.split("/").at(-1);
      if (table === "planned_sessions") {
        if (url.searchParams.get("id") !== `eq.${plannedId}` || url.searchParams.get("user_id") !== `eq.${owner}`) {
          return Response.json([]);
        }
        if (method === "PATCH") {
          if (startBeforeWrite) linkedSessionId = sessionId;
          if (url.searchParams.get("completed_session_id") === "is.null" && linkedSessionId !== null) return Response.json([]);
          const body: { prescription: Prescription } = JSON.parse(String(init?.body));
          prescription = body.prescription;
          updates.push(prescription);
          return Response.json([{ id: plannedId }]);
        }
        return Response.json([{ id: plannedId, user_id: owner, prescription, completed_session_id: linkedSessionId,
          training_blocks: { program_id: "authored" } }]);
      }
      if (table === "movements") return Response.json([{ id: replacementId, slug: "floor-press", display_name: "Floor Press" }]);
      if (table === "training_maxes") return Response.json([{ one_rm_kg: 120, bw_node_id: null }]);
      if (table === "profiles") return Response.json([{ warmup_scheme: {
        setCount: 3, percentLadder: [40, 60, 80], repLadder: [5, 5, 3],
      } }]);
      return Response.json({ code: "XX000", message: "Unexpected test query" }, { status: 500 });
    } },
  }));
});

function input() {
  const form = new FormData();
  form.set("plannedSessionId", plannedId);
  form.set("movementId", originalId);
  form.set("newMovementId", replacementId);
  return form;
}

describe("DC-R6 planned movement load ownership", () => {
  it("saves rebuilt warm-ups with the same program basis and an owned, unstarted target", async () => {
    const result = await swapPlannedMovement(input());
    expect(result.ok).toBe(true);
    expect(result.prescription?.items).toHaveLength(4);
    expect(result.prescription?.items.every((item) => item.meta?.programLoadBasis)).toBe(true);
    expect(updates).toEqual([result.prescription]);
    const write = requests.find((request) => request.method === "PATCH")!;
    expect(write.url.searchParams.get("id")).toBe(`eq.${plannedId}`);
    expect(write.url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    expect(write.url.searchParams.get("completed_session_id")).toBe("is.null");
  });

  it("refuses a concurrent start rather than shifting logged item indices", async () => {
    const before = structuredClone(prescription);
    startBeforeWrite = true;
    expect((await swapPlannedMovement(input())).error).toBeTruthy();
    expect(updates).toEqual([]);
    expect(prescription).toEqual(before);
    expect(linkedSessionId).toBe(sessionId);
  });

  it("rewrites the same slots when the workout is already started", async () => {
    linkedSessionId = sessionId;
    const result = await swapPlannedMovement(input());
    expect(result.ok).toBe(true);
    expect(result.prescription?.items.map((item) => item.kind)).toEqual(["warmup", "main"]);
    expect(result.prescription?.items.every((item) => item.meta?.programLoadBasis)).toBe(true);
  });

  it("warns without carrying a different movement's fixed working max", async () => {
    prescription.items.forEach((item) => { item.meta = { programLoadBasis: { version: 1, kind: "working-max", kg: 100 } }; });
    const result = await swapPlannedMovement(input());
    expect(result.ok).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.prescription?.items.every((item) => item.percentTm === undefined && item.targetWeightKg === undefined)).toBe(true);
  });
});
