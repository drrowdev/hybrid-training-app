import { createClient } from "@supabase/supabase-js";
import { hyroxEngine, hyroxSessionIdForRef, getHyroxSession } from "@hta/hyrox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeHyroxSession } from "./complete-action";

const mock = vi.hoisted(() => ({ client: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("@/lib/platform/completion", () => ({ reconcileCompletedProgram: mock.reconcile }));
vi.mock("@/lib/sessions/post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async () => undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const owner = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";
const instance = hyroxEngine.setup({ values: { experience: "beginner" } }, { oneRepMaxes: {}, roundingKg: 2.5 });
const run = hyroxEngine.timeline(instance).find((item) => {
  const id = hyroxSessionIdForRef(instance, item.ref);
  return id && getHyroxSession(id)?.category === "run";
});
let writes: { name: string; args: Record<string, unknown> }[];

beforeEach(() => {
  writes = [];
  mock.reconcile.mockReset().mockImplementation(async (_client, user, session) => {
    expect(user).toBe(owner);
    expect(session).toBe(sessionId);
    expect(writes).toHaveLength(1);
  });
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const name = url.pathname.split("/").at(-1)!;
      if (init?.method === "POST") {
        writes.push({ name, args: JSON.parse(String(init.body)) });
        return Response.json(null);
      }
      if (name === "sessions") return Response.json([{ id: sessionId, user_id: owner, completed_at: null, prescription: {} }]);
      if (name === "planned_sessions") {
        expect(url.searchParams.get("completed_session_id")).toBe(`eq.${sessionId}`);
        return Response.json([{ block_id: blockId, prescription: { programRef: run?.ref } }]);
      }
      if (name === "program_instances") {
        expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
        expect(url.searchParams.get("block_id")).toBe(`eq.${blockId}`);
        expect(url.searchParams.has("status")).toBe(false);
        return Response.json([{ program_id: "hyrox", instance }]);
      }
      throw new Error(`Unexpected ${name}`);
    } },
  }));
});

describe("DC-R5 structured workout completion", () => {
  it("records a started workout from its original archived program, then reconciles only that workout", async () => {
    expect(run).toBeDefined();
    expect(await completeHyroxSession({ sessionId, totalDurationSec: 1800, sessionRpe: 6 })).toEqual({ ok: true });
    expect(writes[0]).toMatchObject({ name: "replace_hyrox_session_actuals", args: { p_session_id: sessionId } });
    expect(mock.reconcile).toHaveBeenCalledOnce();
  });

  it("reports saved actuals when progression needs retry rather than claiming the workout was unsaved", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mock.reconcile.mockRejectedValue(new Error("Temporary failure"));
      const result = await completeHyroxSession({ sessionId, totalDurationSec: 1800, sessionRpe: 6 });
      expect(writes).toHaveLength(1);
      expect(result.error).toMatch(/workout saved/i);
      expect(result.ok).toBeUndefined();
    } finally { errors.mockRestore(); }
  });
});
