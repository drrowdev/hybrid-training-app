import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { ProgramInstanceWrite } from "../../platform/program-instance";
import { SWIM_COURSE_VERSION } from "@hta/domain";
import { programConditioningSchema, planConditioningCourse } from "../conditioning-input";
import { SwimInputError } from "../input-error";

const { owned, safety } = vi.hoisted(() => ({ owned: vi.fn(), safety: vi.fn() }));
vi.mock("../capability", () => ({ requireSwimSetup: vi.fn(async () => {}) }));
vi.mock("../course-capability", () => ({ privateSwimCourseAvailable: vi.fn(async () => true) }));
vi.mock("../server-context", async (original) => ({
  ...await original<typeof import("../server-context")>(), ownedSwimPlan: owned,
}));
vi.mock("../workout-safety", () => ({ checkSwimWorkouts: safety }));
vi.mock("../queries", () => ({
  swimToday: async () => ({ today: "2026-09-14" }),
  swimInputId: () => "00000000-0000-4000-8000-000000000005",
}));
import {
  applyConditioningChoices, deployProgramWithSwimming, prepareConditioningSwim,
  programConditioningAvailable, readConditioningSave,
} from "../program-conditioning";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = {
  version: SWIM_COURSE_VERSION, title: "Synthetic course", source: { reference: "Synthetic", edition: "1" },
  weeks: [0, 1].map(() => ({ workouts: [{
    title: "Swim", sections: ["warmup", "main", "cooldown"].map((kind) => ({
      kind, label: kind, rounds: 1,
      items: [{ repeats: 1, distanceMetres: 50, stroke: "freestyle", effort: "easy", equipment: [] }],
    })),
  }] })),
};
const input = () => programConditioningSchema.parse({
  requestId: id(1), choices: [{ weekday: 2, activity: "swimming" }],
  swim: {
    kind: "course", courseFile: JSON.stringify(source), pool: "50m", experience: "regular",
    comfortableLengths: 8, strokes: ["freestyle"], equipment: [], reviewed: true,
  },
});
const write = (): ProgramInstanceWrite => ({
  weeks: 2, daysPerWeek: 1, dayIndexOverrides: { days: [0], twoADay: false }, tmPercents: [], skipped: [],
  sessions: [0, 1].flatMap((weekIndex) => [
    {
      ref: `strength-${weekIndex}`, weekIndex, dayIndex: 0, slot: "single" as const,
      title: "Strength", role: "strength", prescription: { items: [] },
      sessionModality: "pure_strength" as const, effectiveStressLoad: 0, skipped: [],
    },
    {
      ref: `cardio-${weekIndex}`, weekIndex, dayIndex: 2, slot: "single" as const,
      title: "Cardio", role: "cardio",
      prescription: { items: [{ movementId: "", kind: "cardio_external" as const }], programRef: `cardio-${weekIndex}` },
      sessionModality: "pure_z2_aerobic" as const, effectiveStressLoad: 0, skipped: [],
    },
  ]),
});
let body: unknown;
let response: unknown;
let status: number;
const paths: string[] = [];
const client = createClient("https://conditioning.test", "synthetic-test-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, init) => {
    const path = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
    paths.push(path);
    body = init?.body ? JSON.parse(String(init.body)) : null;
    return Response.json(path.endsWith("_ready") ? true : response, { status });
  } },
});
beforeEach(() => {
  vi.stubEnv("SWIM_CONDITIONING_ENABLED", "true");
  owned.mockReset(); safety.mockReset(); safety.mockResolvedValue(undefined);
  response = []; status = 200; body = undefined; paths.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW3/SW5/SW8 single programme/swim save", () => {
  it("uses primary weekdays and untimed source prescriptions for inline preview and save", async () => {
    const value = input();
    if (value.swim?.kind !== "course") throw new Error("Expected course fixture");
    const preview = planConditioningCourse(value.swim, "2026-09-14", [2]);
    const prepared = await prepareConditioningSwim(client, id(9), "2026-09-14", write(), value);
    expect(prepared.workouts?.map((row) => row.scheduled_date)).toEqual(["2026-09-16", "2026-09-23"]);
    expect(prepared.workouts).toEqual(preview.workouts);
    expect(prepared.definition?.setup.sessionBudgetMinutes).toBeNull();
    expect(safety).toHaveBeenCalledOnce();
  });

  it("changes only explicitly selected open conditioning, preserving strength and the input", () => {
    const before = write();
    const copy = structuredClone(before);
    const result = applyConditioningChoices(before, input());
    expect(before).toEqual(copy);
    expect(result.sessions[0]).toBe(before.sessions[0]);
    expect(result.sessions[1]?.prescription.programRef).toBe(before.sessions[1]?.prescription.programRef);
    expect(result.sessions[1]?.title).not.toBe(before.sessions[1]?.title);
    expect(result.sessions[1]?.sessionModality).toBe(before.sessions[1]?.sessionModality);
    expect(result.sessions[1]?.effectiveStressLoad).toBe(before.sessions[1]?.effectiveStressLoad);
  });

  it("refuses a choice without an eligible slot rather than changing strength", () => {
    expect(() => applyConditioningChoices(write(), { ...input(), choices: [{ weekday: 0, activity: "swimming" }] }))
      .toThrow(SwimInputError);
  });

  it("rejects incomplete course fit and unreviewed imports before a database write", async () => {
    const value = input();
    const short = write(); short.sessions = short.sessions.slice(0, 2);
    await expect(prepareConditioningSwim(client, id(9), "2026-09-14", short, value)).rejects.toThrow(SwimInputError);
    if (value.swim?.kind !== "course") throw new Error("Expected course fixture");
    value.swim.reviewed = false;
    await expect(prepareConditioningSwim(client, id(9), "2026-09-14", write(), value)).rejects.toThrow(SwimInputError);
    expect(paths.every((path) => path.endsWith("_ready"))).toBe(true);
  });

  it("checks ownership, unchanged placement and current safety when attaching an existing plan", async () => {
    const value = input();
    if (value.swim?.kind !== "course") throw new Error("Expected course fixture");
    const plan = planConditioningCourse(value.swim, "2026-09-14", [2]);
    owned.mockResolvedValue({
      plan: { id: id(2), revision: 3, status: "active" },
      workouts: plan.workouts.map((workout, index) => ({ ...workout, id: id(index + 6), status: "scheduled", session_id: null })),
    });
    const prepared = await prepareConditioningSwim(client, id(9), "2026-09-14", write(), {
      ...value, swim: { kind: "existing", planId: id(2), revision: 3 },
    });
    expect(prepared).toEqual({ plan_id: id(2), expected_revision: 3 });
    expect(owned).toHaveBeenCalledWith(client, id(9), id(2), 3);
    expect(safety).toHaveBeenCalledOnce();
  });

  it("keeps new setup off while still allowing a prior receipt to be read", async () => {
    vi.stubEnv("SWIM_CONDITIONING_ENABLED", "false");
    expect(await programConditioningAvailable(client)).toBe(false);
    expect(paths).toEqual([]);
    response = [{ block_id: id(2), program_instance_id: id(3), swim_plan_id: id(4), skipped: 2 }];
    expect((await readConditioningSave(client, id(1), { choices: [] }))?.skipped).toBe(2);
  });

  it("does not fall back to independent writes when the coupled RPC is missing", async () => {
    status = 404; response = { code: "PGRST202", message: "private database diagnostic" };
    await expect(deployProgramWithSwimming(client, id(1), {}, {
      p_block: {}, p_planned_sessions: [], p_tm_percents: [], p_program_instance: {},
    }, { plan_id: id(2), expected_revision: 1 })).rejects.toThrow(SwimInputError);
    expect(paths).toEqual(["/rest/v1/rpc/deploy_program_with_swimming"]);
  });

  it("validates the receipt and sends the original request separately from computed writes", async () => {
    const receipt = { block_id: id(2), program_instance_id: id(3), swim_plan_id: id(4), skipped: 2 };
    response = [receipt];
    const intent = { conditioning: { choices: [] } };
    const args = { p_block: {}, p_planned_sessions: [], p_tm_percents: [], p_program_instance: {} };
    expect(await deployProgramWithSwimming(client, id(1), intent, args, { plan_id: id(2), expected_revision: 1 })).toEqual(receipt);
    expect(body).toMatchObject({ p_request_id: id(1), p_request_input: intent, ...args });
    response = [];
    await expect(deployProgramWithSwimming(client, id(1), intent, args, { plan_id: id(2), expected_revision: 1 })).rejects.toThrow();
  });

  it("rejects user IDs, timing inputs and contradictory selections in the strict request", () => {
    expect(programConditioningSchema.safeParse({ ...input(), userId: id(9) }).success).toBe(false);
    expect(programConditioningSchema.safeParse({ ...input(), swim: { ...input().swim, timeBudgetMinutes: 30 } }).success).toBe(false);
    expect(programConditioningSchema.safeParse({ ...input(), choices: [] }).success).toBe(false);
  });
});
