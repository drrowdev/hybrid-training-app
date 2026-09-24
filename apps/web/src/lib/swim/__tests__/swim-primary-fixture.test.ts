import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { seedSwimPrimaryBaseline } from "../../../../e2e/fixtures/swim-primary";
import { authoredProgramSchema } from "../../programs/authored/schema";
import { authoredProgramDates } from "@hta/domain";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const prescription = { items: [{ movementId: id(2), movementName: "Bench press", kind: "main" as const, sets: 3, reps: 5 }] };
type Failure = "owner" | "create" | "count" | "prescription" | "targets" | "start" | "complete" | "receipt";

function fixture(failure?: Failure) {
  const writes: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  let completed = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const name = url.pathname.split("/").at(-1)!;
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (name === "movements") return respond(url.searchParams.get("select") === "id" ? { id: id(2) } : [{
      id: id(2), slug: "bench-press-flat", display_name: "Bench press", pattern: "horizontal_push", metadata: {},
    }]);
    if (name === "planned_sessions") {
      if (init?.method === "PATCH") {
        writes.push({ rpc: "prescription", args: JSON.parse(String(init.body)) });
        expect(completed).toBe(false);
        expect(url.searchParams.get("user_id")).toBe(`eq.${id(1)}`);
        expect(url.searchParams.get("block_id")).toBe(`eq.${id(3)}`);
        expect(url.searchParams.get("id")).toBe(`in.(${id(4)},${id(5)})`);
        if (failure === "prescription") return respond({ message: "Synthetic prescription refusal" }, 400);
        if (failure === "targets") return respond([{ id: id(4) }, { id: id(9) }]);
      }
      return respond(failure === "count" ? [{ id: id(4) }] : [{ id: id(4) }, { id: id(5) }]);
    }
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    writes.push({ rpc: name, args });
    if (name === "training_schedule_snapshot") return respond({ revision: "a".repeat(32) });
    if (name === "independent_program_schedule_commit") return failure === "create"
      ? respond({ message: "Synthetic creation refusal" }, 400) : respond({ block_id: id(3), program_instance_id: id(7) });
    if (name === "start_planned_session_atomically") return failure === "start"
      ? respond({ message: "Synthetic start refusal" }, 400) : respond(id(6));
    if (name === "complete_training_session_with_transition") {
      completed = true;
      return failure === "complete" ? respond({ message: "Synthetic completion refusal" }, 400)
        : respond([{ user_id: failure === "receipt" ? id(9) : id(1), transitioned: true }]);
    }
    throw new Error(`Unexpected synthetic request: ${name}`);
  });
  const actor = createClient("http://127.0.0.1:54321", "synthetic-anon", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  vi.spyOn(actor.auth, "getUser").mockResolvedValue({ data: { user: {
    id: failure === "owner" ? id(9) : id(1), app_metadata: {}, user_metadata: {},
    aud: "authenticated", created_at: "2026-09-01T00:00:00Z",
  } }, error: null });
  return { actor, writes, fetch };
}

describe("DC-K4/DC-SW7 typed primary fixture preserves the swimming baseline", () => {
  it.each([
    ["2026-09-21", "2026-09-28"], ["2026-09-22", "2026-09-29"], ["2026-09-23", "2026-09-30"],
    ["2026-09-24", "2026-10-01"], ["2026-09-25", "2026-10-02"], ["2026-09-26", "2026-10-03"],
    ["2026-09-27", "2026-10-04"],
  ])("creates two planned workouts and completes only one from %s", async (startedOn, nextWeek) => {
    const { actor, writes } = fixture();
    expect(await seedSwimPrimaryBaseline(actor, id(1), startedOn, prescription)).toEqual({
      blockId: id(3), plannedIds: [id(4), id(5)],
    });
    const commit = writes.find(({ rpc }) => rpc === "independent_program_schedule_commit")!;
    expect(commit.args).toMatchObject({ p_operation: "primary-create", p_expected_revision: "a".repeat(32),
      p_args: { p_block: { program_kind: "strength", program_id: "authored", program_family: "strength", started_on: startedOn, weeks: 2 },
        p_program_instance: { program_id: "authored", program_family: "strength" },
        p_planned_sessions: [{ week_index: 0 }, { week_index: 1 }] } });
    const payload = commit.args.p_args as { p_program_instance: { instance: unknown }; p_planned_sessions: unknown[] };
    const definition = authoredProgramSchema.parse(payload.p_program_instance.instance);
    expect(authoredProgramDates(definition, startedOn).map(({ date }) => date))
      .toEqual([startedOn, nextWeek]);
    expect(payload.p_planned_sessions).toHaveLength(2);
    expect(writes.map(({ rpc }) => rpc)).toEqual([
      "training_schedule_snapshot", "independent_program_schedule_commit", "prescription",
      "start_planned_session_atomically", "complete_training_session_with_transition",
    ]);
    expect(writes.find(({ rpc }) => rpc === "prescription")!.args).toEqual({ prescription });
    expect(writes.filter(({ rpc }) => rpc === "start_planned_session_atomically"))
      .toEqual([{ rpc: "start_planned_session_atomically", args: { p_planned_id: id(4) } }]);
    expect(writes.filter(({ rpc }) => rpc === "complete_training_session_with_transition"))
      .toEqual([{ rpc: "complete_training_session_with_transition", args: {
        p_session_id: id(6), p_notes: null, p_completion_entry_id: expect.any(String),
      } }]);
  });

  it.each(["owner", "create", "count", "prescription", "targets", "start", "complete", "receipt"] as const)("surfaces %s failure without a success-shaped baseline", async (failure) => {
    const { actor, writes, fetch } = fixture(failure);
    await expect(seedSwimPrimaryBaseline(actor, id(1), "2026-09-24", prescription)).rejects.toThrow();
    if (failure === "owner") expect(fetch).not.toHaveBeenCalled();
    if (["owner", "create", "count", "prescription", "targets", "start"].includes(failure)) {
      expect(writes.filter(({ rpc }) => rpc === "complete_training_session_with_transition")).toEqual([]);
    }
    if (["prescription", "targets"].includes(failure)) {
      expect(writes.filter(({ rpc }) => rpc === "start_planned_session_atomically")).toEqual([]);
    }
  });
});
