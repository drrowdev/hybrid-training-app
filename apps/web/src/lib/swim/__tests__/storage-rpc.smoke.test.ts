import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SwimActualResult, SwimPlanDefinition, SwimPlanState, SwimWorkoutDefinition } from "@hta/db";
import type { SwimWorkout } from "@hta/domain";
import { createSmokeClient, createSmokeSession, getMovementIdBySlug, RUN_ID } from "../../../../e2e-rpc/setup";
import type { SwimCompletion, SwimPlanWithWorkouts, SwimWorkoutRow } from "../storage";
import { getSwimRpcTestEnv } from "./storage-rpc-config";

// Run with apps/web/vitest.config.ts; see the pool-swimming wiki's JSON ledger command.
// Never consume the app's production credentials or apply migrations here.
const smokeEnv = getSwimRpcTestEnv();
const anonKey = smokeEnv?.anonKey;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const prescription = (): SwimWorkout => ({
  kind: "swim_workout", focus: "endurance", totalLengths: 3, estimatedMs: null,
  budget: { minutes: 30, accountedMs: 60_000 },
  snapshot: {
    course: { numerator: 100, denominator: 3, unit: "m" },
    strokes: ["freestyle"], equipment: [], protocol: null, calibration: null,
    versions: { model: "swim-model-1", generator: "swim-rpc-test", assessment: null },
  },
  sections: (["warmup", "main", "cooldown"] as const).map((kind) => ({
    kind, label: kind, rounds: 1,
    items: [{ repeats: 1, lengths: 1, stroke: "freestyle", equipment: [], effort: "easy", optional: false, restSeconds: 20 }],
  })),
});
const definition = (): SwimWorkoutDefinition => ({
  version: 1, original: prescription(), issued: prescription(), modifications: [],
});
const planDefinition = (): SwimPlanDefinition => ({
  version: 1, generatorVersion: "swim-rpc-test",
  setup: {
    goal: "endurance", experience: "recreational", course: prescription().snapshot.course,
    knownStrokes: ["freestyle"], equipment: [], recentComfortableLengths: 12, sessionBudgetMinutes: 30,
  },
});
const state = (): SwimPlanState => ({ version: 1, observations: [], acceptedCalibration: null, decisions: [] });
const result = (): SwimActualResult => ({
  version: 1, snapshot: prescription().snapshot, lengths: 3, timeMs: 200_005, rpe: 5,
  completion: "completed", splits: [{ lengths: 1, timeMs: 55_005 }],
  provenance: { source: "manual", recordedAt: new Date().toISOString() },
});

function verifiedCalibration() {
  const observation = {
    protocol: "css_200_400", version: "swim-css-1", observedOn: day(0), verified: true,
    course: prescription().snapshot.course, stroke: "freestyle", equipment: [],
    trials: [
      { distance: 200, lengths: 6, timeMs: 200_000 },
      { distance: 400, lengths: 12, timeMs: 440_001 },
    ],
  };
  return {
    version: "swim-css-1", protocol: observation.protocol, course: observation.course,
    stroke: observation.stroke, equipment: [], unit: "m", heuristic: true,
    msPer100: 120_000.5, notes: [], observation,
  };
}

async function rpc<T>(db: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await db.rpc(name, args);
  if (response.error) throw new Error(`${name}: ${response.error.message}`, { cause: response.error });
  return response.data as T;
}

describe.skipIf(!smokeEnv || !anonKey)("ADR0079 dedicated authenticated swim RPCs (DC-SW6/DC-SW7)", () => {
  let admin: SupabaseClient;
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceId: string;
  let bobId: string;
  let easyMovementId: string;
  let intervalMovementId: string;
  const users = new Set<string>();

  async function user(label: string) {
    const email = `swim-${RUN_ID}-${label}-${randomUUID()}@hta-e2e.com`;
    const password = `Swim-${randomUUID()}-Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "User not created");
    users.add(created.data.user.id);
    const client = createClient(smokeEnv!.url, anonKey!, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(signedIn.error.message);
    return { id: created.data.user.id, client };
  }

  async function createPlan(client = alice, offsets = [1, 2]): Promise<SwimPlanWithWorkouts> {
    return rpc(client, "swim_create_plan", {
      p_started_on: day(Math.min(...offsets)), p_ends_on: day(30), p_definition: planDefinition(), p_state: state(),
      p_workouts: offsets.map((offset) => ({ scheduled_date: day(offset), slot: "single", definition: definition() })),
    });
  }

  const start = (workout: SwimWorkoutRow, client = alice) =>
    rpc<SwimWorkoutRow>(client, "swim_start_workout", { p_workout_id: workout.id, p_expected_revision: workout.revision });

  function completionArgs(workout: SwimWorkoutRow) {
    return {
      p_workout_id: workout.id, p_expected_revision: workout.revision, p_result: result(),
      p_client_log_id: randomUUID(), p_completion_entry_id: randomUUID(),
      p_notes: null, p_allow_changed_course: false,
    };
  }

  beforeAll(async () => {
    admin = createSmokeClient(smokeEnv!);
    expect(await rpc(admin, "swim_storage_ready")).toBe(true);
    // The dedicated project must have its normal catalog seed. Never create
    // replacement global catalog rows as a fallback in an acceptance test.
    easyMovementId = await getMovementIdBySlug(admin, "swim-easy");
    intervalMovementId = await getMovementIdBySlug(admin, "swim-intervals");
    ({ id: aliceId, client: alice } = await user("alice"));
    ({ id: bobId, client: bob } = await user("bob"));
    expect(await rpc(alice, "swim_storage_ready")).toBe(true);
  });

  beforeEach(async () => {
    for (const client of [alice, bob]) {
      const { data, error } = await client.from("swim_plans").select("id,revision").eq("status", "active");
      if (error) throw new Error(error.message);
      for (const plan of data ?? []) {
        await rpc(client, "swim_set_plan_status", { p_plan_id: plan.id, p_expected_revision: plan.revision, p_status: "archived" });
      }
    }
  });

  afterAll(async () => {
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`Swim test cleanup: ${error.message}`);
    }
  });

  it("DC-SW8 hides Alice's plan from Bob", async () => {
    const created = await createPlan();
    const hidden = await bob.from("swim_plans").select("id").eq("id", created.plan.id);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it("DC-SW8 rejects Bob starting Alice's workout", async () => {
    const created = await createPlan();
    const response = await bob.rpc("swim_start_workout", { p_workout_id: created.workouts[0]!.id, p_expected_revision: 1 });
    expect(response.error?.code).toBe("P0001");
    expect(response.error?.message).toBe("Swimming workout not found.");
    const unchanged = await alice.from("swim_workouts").select("*").eq("id", created.workouts[0]!.id).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual(created.workouts[0]);
  });

  it("DC-SW8 rejects direct authenticated workout reassignment", async () => {
    const created = await createPlan();
    const other = await createPlan(bob);
    const response = await alice.from("swim_workouts").update({ plan_id: other.plan.id }).eq("id", created.workouts[0]!.id);
    expect(response.error?.code).toBe("42501");
    const unchanged = await alice.from("swim_workouts").select("*").eq("id", created.workouts[0]!.id).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual(created.workouts[0]);
  });

  it("DC-SW8 rejects a cross-owner plan link with the ownership foreign key", async () => {
    const created = await createPlan();
    const other = await createPlan(bob);
    const crossPlan = await admin.from("swim_workouts").update({ plan_id: other.plan.id }).eq("id", created.workouts[0]!.id);
    expect(crossPlan.error?.code).toBe("23503");
    expect(crossPlan.error?.message).toContain("swim_workouts_owned_plan_fk");
    const unchanged = await admin.from("swim_workouts").select("*")
      .in("plan_id", [created.plan.id, other.plan.id]).order("id");
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual([...created.workouts, ...other.workouts].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("DC-SW8 rejects an unlinked cross-owner session with the ownership foreign key", async () => {
    const created = await createPlan();
    const otherSessionId = await createSmokeSession(admin, bobId, "unlinked-owner-fk");
    const beforeSession = await admin.from("sessions").select("*").eq("id", otherSessionId).single();
    expect(beforeSession.error).toBeNull();
    expect(beforeSession.data?.user_id).toBe(bobId);
    const beforeLinks = await admin.from("swim_workouts").select("id").eq("session_id", otherSessionId);
    expect(beforeLinks.error).toBeNull();
    expect(beforeLinks.data).toEqual([]);

    const crossSession = await admin.from("swim_workouts").update({ session_id: otherSessionId }).eq("id", created.workouts[0]!.id);
    expect(crossSession.error?.code).toBe("23503");
    expect(crossSession.error?.message).toContain("swim_workouts_owned_session_fk");
    const unchanged = await alice.from("swim_workouts").select("*").eq("plan_id", created.plan.id).order("id");
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual([...created.workouts].sort((a, b) => a.id.localeCompare(b.id)));
    const afterLinks = await admin.from("swim_workouts").select("id").eq("session_id", otherSessionId);
    expect(afterLinks.error).toBeNull();
    expect(afterLinks.data).toEqual([]);
    const afterSession = await admin.from("sessions").select("*").eq("id", otherSessionId).single();
    expect(afterSession.error).toBeNull();
    expect(afterSession.data).toEqual(beforeSession.data);
  });

  it("DC-SW8 rejects duplicate same-owner session links with the unique constraint", async () => {
    const created = await createPlan();
    const started = await start(created.workouts[0]!);
    expect(started.session_id).not.toBeNull();
    const before = await alice.from("swim_workouts").select("*").eq("plan_id", created.plan.id).order("id");
    expect(before.error).toBeNull();
    const duplicate = await admin.from("swim_workouts").update({ session_id: started.session_id }).eq("id", created.workouts[1]!.id);
    expect(duplicate.error?.code).toBe("23505");
    expect(duplicate.error?.message).toContain("swim_workouts_session_id_key");
    const after = await alice.from("swim_workouts").select("*").eq("plan_id", created.plan.id).order("id");
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  });

  it("DC-SW7 creates standalone swim plans without primary program, block or season rows", async () => {
    await createPlan();
    for (const table of ["training_blocks", "program_instances", "training_seasons"]) {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", aliceId);
      expect(error).toBeNull();
      expect(count).toBe(0);
    }
  });

  it("rolls back an entire create when a later prescription is invalid", async () => {
    const invalid = definition();
    invalid.issued = { ...invalid.issued, totalLengths: 999 };
    const response = await alice.rpc("swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(), p_state: state(),
      p_workouts: [
        { scheduled_date: day(1), slot: "single", definition: definition() },
        { scheduled_date: day(2), slot: "single", definition: invalid },
      ],
    });
    expect(response.error).not.toBeNull();
    const remaining = await alice.from("swim_plans").select("id").eq("status", "active");
    expect(remaining.error).toBeNull();
    expect(remaining.data).toHaveLength(0);
  });

  it.each(["paused", "finished", "archived"] as const)("DC-SW7 rejects direct skips on a %s plan without changing history or resume candidates", async (status) => {
    const created = await createPlan();
    await rpc(alice, "swim_set_plan_status", {
      p_plan_id: created.plan.id, p_expected_revision: created.plan.revision, p_status: status,
    });
    const beforePlan = await alice.from("swim_plans").select("*").eq("id", created.plan.id).single();
    const beforeWorkouts = await alice.from("swim_workouts").select("*").eq("plan_id", created.plan.id).order("id");
    expect(beforePlan.error).toBeNull();
    expect(beforeWorkouts.error).toBeNull();
    const skipped = await alice.rpc("swim_skip_workout", {
      p_workout_id: created.workouts[0]!.id, p_expected_revision: created.workouts[0]!.revision,
      p_reason: "No pool access",
    });
    expect(skipped.error?.code).toBe("P0001");
    const afterPlan = await alice.from("swim_plans").select("*").eq("id", created.plan.id).single();
    const afterWorkouts = await alice.from("swim_workouts").select("*").eq("plan_id", created.plan.id).order("id");
    expect(afterPlan.error).toBeNull();
    expect(afterWorkouts.error).toBeNull();
    expect(afterPlan.data).toEqual(beforePlan.data);
    expect(afterWorkouts.data).toEqual(beforeWorkouts.data);
  });

  it("serializes starts and completions; new-UUID replay never overwrites actuals", async () => {
    const created = await createPlan();
    const starts = await Promise.all([start(created.workouts[0]!), start(created.workouts[0]!)]);
    expect(starts[0].session_id).toBe(starts[1].session_id);
    const first = completionArgs(starts[0]);
    const second = completionArgs(starts[1]);
    const completed = await Promise.all([
      rpc<SwimCompletion>(alice, "swim_complete_workout", first),
      rpc<SwimCompletion>(alice, "swim_complete_workout", second),
    ]);
    expect(completed.filter((row) => row.transitioned)).toHaveLength(1);
    expect((await rpc<SwimCompletion>(alice, "swim_complete_workout", first)).transitioned).toBe(false);
    const replay = await rpc<SwimCompletion>(alice, "swim_complete_workout", {
      ...completionArgs(starts[0]), p_result: { invalid: true },
    });
    expect(replay.transitioned).toBe(false);
    const rows = await alice.from("cardio_logs").select("*").eq("session_id", starts[0].session_id!);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0].swim_result.timeMs).toBe(200_005);
    expect(Number(rows.data![0].distance_km)).toBe(0.1);
    expect(rows.data![0].duration_sec).toBe(200);
    expect(Number(rows.data![0].rpe)).toBe(5);
    const session = await alice.from("sessions").select("completion_outbox_entry_id,completed_at").eq("id", starts[0].session_id!).single();
    expect(session.error).toBeNull();
    expect(session.data!.completed_at).not.toBeNull();
    expect([first.p_completion_entry_id, second.p_completion_entry_id]).toContain(session.data!.completion_outbox_entry_id);
    const another = await start(created.workouts[1]!);
    expect((await alice.rpc("swim_complete_workout", {
      ...completionArgs(another), p_completion_entry_id: session.data!.completion_outbox_entry_id,
    })).error).not.toBeNull();
    const rolledBack = await alice.from("cardio_logs").select("id").eq("session_id", another.session_id!);
    expect(rolledBack.error).toBeNull();
    expect(rolledBack.data).toHaveLength(0);
  });

  it("rejects missing, fractional and out-of-bounds known-time budgets atomically", async () => {
    for (const budget of [
      { minutes: 30 }, { minutes: 0, accountedMs: 60_000 },
      { minutes: 30.5, accountedMs: 60_000 },
      { minutes: 30, accountedMs: -1 }, { minutes: 30, accountedMs: 1.5 },
      { minutes: 30, accountedMs: 86_400_001 },
    ]) {
      const workout = { ...prescription(), budget };
      expect((await alice.rpc("swim_create_plan", {
        p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(), p_state: state(),
        p_workouts: [{
          scheduled_date: day(1), slot: "single",
          definition: { version: 1, original: workout, issued: workout, modifications: [] },
        }],
      })).error).not.toBeNull();
    }
    const remaining = await alice.from("swim_plans").select("id").eq("status", "active");
    expect(remaining.error).toBeNull();
    expect(remaining.data).toHaveLength(0);
  });

  it("DC-SW6 rejects impossible accepted trial pairs and dates while retaining a valid half-millisecond pace", async () => {
    function args(t400: number, observedOn = day(0)) {
      const observation = {
        protocol: "css_200_400", version: "swim-css-1", observedOn, verified: true,
        course: prescription().snapshot.course, stroke: "freestyle", equipment: [],
        trials: [
          { distance: 200, lengths: 6, timeMs: 200_000 },
          { distance: 400, lengths: 12, timeMs: t400 },
        ],
      };
      return {
        p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
        p_state: {
          ...state(), observations: [observation],
          acceptedCalibration: {
            version: "swim-css-1", protocol: observation.protocol, course: observation.course,
            stroke: observation.stroke, equipment: [], unit: "m", heuristic: true,
            msPer100: (t400 - 200_000) / 2, notes: [], observation,
          },
        },
        p_workouts: [{ scheduled_date: day(1), slot: "single", definition: definition() }],
      };
    }
    for (const invalid of [
      args(399_999), args(400_000), args(500_000),
      args(400_001, "2026-02-31"), args(400_001, "2026-04-31"), args(400_001, "2026-02-29"),
    ]) {
      expect((await alice.rpc("swim_create_plan", invalid)).error).not.toBeNull();
    }
    const valid = await rpc<SwimPlanWithWorkouts>(alice, "swim_create_plan", args(400_001));
    expect(valid.plan.state.acceptedCalibration?.msPer100).toBe(100_000.5);
  });

  it("DC-SW2 accepts only verified supported calibration while retaining unverified observations", async () => {
    const calibration = verifiedCalibration();
    const unverified = [
      { ...calibration.observation, verified: false },
      { ...calibration.observation, verified: undefined },
      { ...calibration.observation, verified: "true" },
      { ...calibration.observation, version: "unsupported-assessment" },
    ];
    for (const rejected of [
      ...unverified.map((observation) => ({ ...calibration, observation })),
      { ...calibration, version: "unsupported-calibration" },
    ]) {
      expect((await alice.rpc("swim_create_plan", {
        p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
        p_state: { ...state(), observations: [rejected.observation], acceptedCalibration: rejected },
        p_workouts: [{ scheduled_date: day(1), slot: "single", definition: definition() }],
      })).error).not.toBeNull();
    }
    const history = unverified.filter((observation) => observation.verified !== "true");
    const retained = await rpc<SwimPlanWithWorkouts>(alice, "swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
      p_state: { ...state(), observations: history, acceptedCalibration: null },
      p_workouts: [{ scheduled_date: day(1), slot: "single", definition: definition() }],
    });
    expect(retained.plan.state.acceptedCalibration).toBeNull();
    expect(retained.plan.state.observations).toEqual(JSON.parse(JSON.stringify(history)));
  });

  it("DC-SW2 binds compact pace to its verified source on prescription, completion and edit", async () => {
    const calibration = verifiedCalibration();
    const proof = {
      msPer100: calibration.msPer100, unit: calibration.unit, protocol: calibration.protocol,
      observedOn: calibration.observation.observedOn, heuristic: true,
      version: calibration.version,
    };
    const snapshot = {
      ...prescription().snapshot, protocol: calibration.protocol, calibration: proof,
      versions: { ...prescription().snapshot.versions, assessment: "swim-css-1" },
    };
    const invalidSnapshots = [
      ...[
        { ...proof, msPer100: 120_001 },
        { ...proof, observedOn: day(-1) },
        { ...proof, version: "unsupported-calibration" },
      ].map((value) => ({ ...snapshot, calibration: value })),
      { ...snapshot, versions: { ...snapshot.versions, assessment: "unsupported-assessment" } },
    ];
    for (const invalid of invalidSnapshots) {
      const workout = { ...prescription(), snapshot: invalid };
      expect((await alice.rpc("swim_create_plan", {
        p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
        p_state: { ...state(), observations: [calibration.observation], acceptedCalibration: calibration },
        p_workouts: [{
          scheduled_date: day(1), slot: "single",
          definition: { version: 1, original: workout, issued: workout, modifications: [] },
        }],
      })).error).not.toBeNull();
    }
    const workout = { ...prescription(), snapshot };
    expect((await alice.rpc("swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
      p_state: { ...state(), observations: [{ ...calibration.observation, verified: false }] },
      p_workouts: [{
        scheduled_date: day(1), slot: "single",
        definition: { version: 1, original: workout, issued: workout, modifications: [] },
      }],
    })).error).not.toBeNull();
    const created = await rpc<SwimPlanWithWorkouts>(alice, "swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(),
      p_state: { ...state(), observations: [calibration.observation], acceptedCalibration: calibration },
      p_workouts: [{
        scheduled_date: day(1), slot: "single",
        definition: { version: 1, original: workout, issued: workout, modifications: [] },
      }],
    });
    const started = await start(created.workouts[0]!);
    for (const invalid of invalidSnapshots) {
      expect((await alice.rpc("swim_complete_workout", {
        ...completionArgs(started), p_result: { ...result(), snapshot: invalid },
      })).error).not.toBeNull();
    }
    const completed = await rpc<SwimCompletion>(alice, "swim_complete_workout", {
      ...completionArgs(started), p_result: { ...result(), snapshot },
    });
    for (const invalid of invalidSnapshots) {
      expect((await alice.rpc("swim_edit_result", {
        p_workout_id: started.id, p_expected_revision: completed.workout.revision,
        p_result: { ...result(), snapshot: invalid },
      })).error).not.toBeNull();
    }
    const persisted = await alice.from("cardio_logs").select("swim_result")
      .eq("id", completed.cardio_log_id).single();
    expect(persisted.error).toBeNull();
    expect(persisted.data!.swim_result.snapshot).toEqual(snapshot);
    expect(persisted.data!.swim_result.snapshot.calibration.msPer100).toBe(120_000.5);
  });

  it("rejects generic insert/update/delete/completion and unlinked native results", async () => {
    const started = await start((await createPlan()).workouts[0]!);
    const generic = { session_id: started.session_id!, modality: "swimming", duration_sec: 200, rpe: 5 };
    expect((await alice.from("cardio_logs").insert(generic)).error).not.toBeNull();
    expect((await alice.rpc("complete_training_session_with_transition", {
      p_session_id: started.session_id, p_notes: null, p_completion_entry_id: randomUUID(),
    })).error).not.toBeNull();
    const completed = await rpc<SwimCompletion>(alice, "swim_complete_workout", completionArgs(started));
    expect((await alice.from("cardio_logs").update({ rpe: 1 }).eq("id", completed.cardio_log_id)).error).not.toBeNull();
    expect((await alice.from("cardio_logs").delete().eq("id", completed.cardio_log_id)).error).not.toBeNull();
    expect((await alice.from("sessions").update({ duration_min: 999 }).eq("id", started.session_id!)).error).not.toBeNull();
    expect((await alice.from("sessions").update({ performed_at: new Date().toISOString() }).eq("id", started.session_id!)).error).toBeNull();
    const ordinary = await alice.from("sessions").insert({ user_id: aliceId }).select("id").single();
    expect(ordinary.error).toBeNull();
    expect((await alice.from("cardio_logs").insert({ ...generic, session_id: ordinary.data!.id, swim_result: result() })).error).not.toBeNull();
    expect((await alice.from("cardio_logs").insert({ ...generic, session_id: ordinary.data!.id })).error).toBeNull();
  });

  it("rejects invalid native arithmetic atomically, including non-normalized courses and splits", async () => {
    const started = await start((await createPlan()).workouts[0]!);
    const valid = result();
    const invalids = [
      { ...valid, lengths: 1.5 }, { ...valid, lengths: 2001 },
      { ...valid, timeMs: 1.5 }, { ...valid, timeMs: 86_400_001 }, { ...valid, rpe: 10.1 },
      { ...valid, snapshot: { ...valid.snapshot, course: { numerator: 200, denominator: 6, unit: "m" } } },
      { ...valid, splits: [{ lengths: 4, timeMs: 1 }] },
      { ...valid, splits: [{ lengths: 1, timeMs: 200_006 }] },
    ];
    for (const invalid of invalids) {
      expect((await alice.rpc("swim_complete_workout", { ...completionArgs(started), p_result: invalid })).error).not.toBeNull();
    }
    const logs = await alice.from("cardio_logs").select("id").eq("session_id", started.session_id!);
    expect(logs.error).toBeNull();
    expect(logs.data).toHaveLength(0);
    const session = await alice.from("sessions").select("completed_at,completion_outbox_entry_id").eq("id", started.session_id!).single();
    expect(session.data).toEqual({ completed_at: null, completion_outbox_entry_id: null });
    await rpc(alice, "swim_complete_workout", {
      ...completionArgs(started), p_allow_changed_course: true,
      p_result: {
        ...valid, snapshot: { ...valid.snapshot, course: { numerator: 25, denominator: 1, unit: "yd" } },
        provenance: { ...valid.provenance, deviationReason: "Used the yard pool" },
      },
    });
    const yard = await alice.from("cardio_logs").select("distance_km,swim_result").eq("session_id", started.session_id!).single();
    expect(yard.error).toBeNull();
    expect(Number(yard.data!.distance_km)).toBe(0.069);
    expect(yard.data!.swim_result.snapshot.course).toEqual({ numerator: 25, denominator: 1, unit: "yd" });
  });

  it("requires explicit changed-course consent and preserves original result edits", async () => {
    const started = await start((await createPlan()).workouts[0]!);
    const completed = await rpc<SwimCompletion>(alice, "swim_complete_workout", completionArgs(started));
    const originalResult = result();
    const edited: SwimActualResult = {
      ...originalResult,
      snapshot: { ...originalResult.snapshot, course: { numerator: 3333, denominator: 100, unit: "m" } },
      lengths: 6,
      provenance: { ...originalResult.provenance, deviationReason: "Different pool" },
    };
    const args = { p_workout_id: started.id, p_expected_revision: completed.workout.revision, p_result: edited };
    expect((await alice.rpc("swim_edit_result", args)).error).not.toBeNull();
    const saved = await rpc<SwimCompletion>(alice, "swim_edit_result", { ...args, p_allow_changed_course: true });
    expect(saved.workout.definition.issued.snapshot.course).toEqual(prescription().snapshot.course);
    expect(saved.workout.definition.resultHistory?.[0]?.result.timeMs).toBe(200_005);
    expect((await alice.rpc("swim_edit_result", { ...args, p_allow_changed_course: true })).error?.code).toBe("40001");
    const logs = await alice.from("cardio_logs").select("distance_km,swim_result").eq("session_id", started.session_id!);
    expect(logs.error).toBeNull();
    expect(logs.data).toHaveLength(1);
    expect(Number(logs.data![0].distance_km)).toBe(0.2);
    expect(logs.data![0].swim_result.snapshot.course).toEqual(edited.snapshot.course);
  });

  it("preserves omitted notes and distinguishes explicit replacement from clearing", async () => {
    const started = await start((await createPlan()).workouts[0]!);
    let saved = await rpc<SwimCompletion>(alice, "swim_complete_workout", {
      ...completionArgs(started), p_notes: "Original log note",
    });
    expect((await alice.from("sessions").update({ notes: "Separately edited session note" })
      .eq("id", started.session_id!)).error).toBeNull();
    async function notes() {
      const [session, log] = await Promise.all([
        alice.from("sessions").select("notes").eq("id", started.session_id!).single(),
        alice.from("cardio_logs").select("notes").eq("id", saved.cardio_log_id).single(),
      ]);
      expect(session.error).toBeNull();
      expect(log.error).toBeNull();
      return [session.data!.notes, log.data!.notes];
    }
    saved = await rpc<SwimCompletion>(alice, "swim_edit_result", {
      p_workout_id: started.id, p_expected_revision: saved.workout.revision,
      p_result: { ...result(), timeMs: 210_005 },
    });
    expect(await notes()).toEqual(["Separately edited session note", "Original log note"]);
    for (const value of ["Replacement", null]) {
      saved = await rpc<SwimCompletion>(alice, "swim_edit_result", {
        p_workout_id: started.id, p_expected_revision: saved.workout.revision,
        p_result: result(), p_notes: value, p_notes_supplied: true,
      });
      expect(await notes()).toEqual([value, value]);
    }
  });

  it("appends decisions and issued versions atomically and rejects stale or started edits", async () => {
    const created = await createPlan();
    const initial = created.workouts[0]!;
    const decision = {
      id: randomUUID(), kind: "progression" as const, decision: "accepted" as const,
      recordedAt: new Date().toISOString(), ruleVersion: "test-rule-1", generatorVersion: "swim-rpc-test",
      inputSnapshot: { settledWorkouts: [], choice: "hold" },
    };
    const nextDefinition = definition();
    nextDefinition.issued = {
      ...nextDefinition.issued, totalLengths: 4,
      budget: { ...nextDefinition.issued.budget, accountedMs: 80_000 },
      sections: nextDefinition.issued.sections.map((section) => section.kind === "main"
        ? { ...section, items: [{ ...section.items[0]!, repeats: 2 }] } : section),
    };
    nextDefinition.modifications.push({
      id: randomUUID(), recordedAt: decision.recordedAt, reason: "Accepted next week",
      decisionId: decision.id, previous: definition().issued,
    });
    const args = {
      p_plan_id: created.plan.id, p_expected_revision: 1, p_definition: planDefinition(),
      p_state: { ...state(), decisions: [decision] },
      p_workouts: [{
        id: initial.id, expected_revision: 1, scheduled_date: initial.scheduled_date,
        slot: initial.slot, definition: nextDefinition,
      }],
    };
    // Valid audits do not authorize rewriting plan identity or issuing a
    // prescription for another pool/generator. A rejected transaction changes none of them.
    for (const changedPlan of [
      { ...planDefinition(), setup: { ...planDefinition().setup, course: { numerator: 25, denominator: 1, unit: "m" } } },
      { ...planDefinition(), generatorVersion: "different-generator" },
      { ...planDefinition(), unexpectedIdentity: "rewritten" },
    ]) {
      expect((await alice.rpc("swim_update_plan", { ...args, p_definition: changedPlan })).error).not.toBeNull();
    }
    for (const snapshot of [
      { ...nextDefinition.issued.snapshot, course: { numerator: 25, denominator: 1, unit: "m" } },
      { ...nextDefinition.issued.snapshot, versions: { ...nextDefinition.issued.snapshot.versions, generator: "different-generator" } },
    ]) {
      expect((await alice.rpc("swim_update_plan", {
        ...args, p_workouts: [{
          ...args.p_workouts[0],
          definition: { ...nextDefinition, issued: { ...nextDefinition.issued, snapshot } },
        }],
      })).error).not.toBeNull();
    }
    const unchanged = await alice.from("swim_plans").select("revision,definition,state").eq("id", created.plan.id).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual({ revision: 1, definition: created.plan.definition, state: created.plan.state });
    const updated = await rpc<SwimPlanWithWorkouts>(alice, "swim_update_plan", args);
    expect(updated.plan.revision).toBe(2);
    const workout = updated.workouts.find((row) => row.id === initial.id)!;
    expect(workout.definition.original).toEqual(definition().original);
    expect(workout.definition.issued.totalLengths).toBe(4);
    expect(workout.definition.modifications[0]!.previous.totalLengths).toBe(3);
    expect((await alice.rpc("swim_update_plan", args)).error?.code).toBe("40001");
    expect((await alice.rpc("swim_update_plan", { ...args, p_expected_revision: 2, p_state: state(), p_workouts: [] })).error).not.toBeNull();
    const started = await start(workout);
    const rejected = await alice.rpc("swim_update_plan", {
      ...args, p_expected_revision: 3,
      p_state: { ...state(), decisions: [decision, { ...decision, id: randomUUID() }] },
      p_workouts: [{ ...args.p_workouts[0], expected_revision: started.revision }],
    });
    expect(rejected.error).not.toBeNull();
    const persisted = await alice.from("swim_plans").select("revision,state").eq("id", created.plan.id).single();
    expect(persisted.error).toBeNull();
    expect(persisted.data!.revision).toBe(3);
    expect(persisted.data!.state.decisions).toHaveLength(1);
  });

  it("preserves frozen targets, skip/lifecycle history, trash/undo, hard purge and account cascades", async () => {
    const created = await createPlan();
    const started = await start(created.workouts[0]!);
    await rpc(alice, "swim_skip_workout", { p_workout_id: created.workouts[1]!.id, p_expected_revision: 1 });
    expect((await alice.rpc("swim_skip_workout", { p_workout_id: started.id, p_expected_revision: started.revision })).error).not.toBeNull();
    const paused = await rpc<{ revision: number }>(alice, "swim_set_plan_status", {
      p_plan_id: created.plan.id, p_expected_revision: 3, p_status: "paused",
    });
    expect((await alice.from("swim_workouts").update({ definition: definition() }).eq("id", started.id)).error).not.toBeNull();
    await rpc(alice, "swim_set_plan_status", { p_plan_id: created.plan.id, p_expected_revision: paused.revision, p_status: "archived" });
    const completed = await rpc<SwimCompletion>(alice, "swim_complete_workout", completionArgs(started));
    await rpc(alice, "swim_edit_result", {
      p_workout_id: started.id, p_expected_revision: completed.workout.revision,
      p_result: { ...result(), timeMs: 210_005 },
    });
    expect((await alice.from("sessions").update({ deleted_at: new Date().toISOString() }).eq("id", started.session_id!)).error).toBeNull();
    const trashed = await alice.from("swim_workouts").select("session_id").eq("id", started.id).single();
    expect(trashed.data!.session_id).toBe(started.session_id);
    expect((await alice.from("sessions").update({ deleted_at: null }).eq("id", started.session_id!)).error).toBeNull();
    expect((await alice.from("sessions").delete().eq("id", started.session_id!)).error).toBeNull();
    const purged = await alice.from("swim_workouts").select("user_id,session_id,definition,status").eq("id", started.id).single();
    expect(purged.error).toBeNull();
    expect(purged.data!.user_id).toBe(aliceId);
    expect(purged.data!.session_id).toBeNull();
    expect(purged.data!.definition.issued).toEqual(definition().issued);
    expect(purged.data!.definition.resultHistory).toBeUndefined();
    expect(purged.data!.status).toBe("completed");
    expect((await alice.rpc("swim_start_workout", { p_workout_id: started.id, p_expected_revision: 3 })).error).not.toBeNull();
    const disposable = await user("cascade");
    const ownOther = await createPlan(disposable.client);
    await start(ownOther.workouts[0]!, disposable.client);
    const deleted = await admin.auth.admin.deleteUser(disposable.id);
    expect(deleted.error).toBeNull();
    users.delete(disposable.id);
    const leftovers = await admin.from("swim_workouts").select("id").eq("user_id", disposable.id);
    expect(leftovers.error).toBeNull();
    expect(leftovers.data).toHaveLength(0);
  });

  it("resumes all remaining dates atomically without restoring stale prescriptions", async () => {
    const created = await createPlan(alice, [-1, 1, 2]);
    const paused = await rpc<SwimPlanWithWorkouts["plan"]>(alice, "swim_set_plan_status", {
      p_plan_id: created.plan.id, p_expected_revision: 1, p_status: "paused",
    });
    expect((await alice.rpc("swim_set_plan_status", {
      p_plan_id: created.plan.id, p_expected_revision: paused.revision, p_status: "active",
    })).error).not.toBeNull();
    const eligible = created.workouts.filter((row) => paused.state.pauseSnapshot!.workoutIds.includes(row.id));
    const missed = created.workouts.find((row) => row.scheduled_date === day(-1))!;
    expect(eligible).toHaveLength(2);
    expect(paused.state.pauseSnapshot!.workoutIds).not.toContain(missed.id);
    const proposed = {
      p_plan_id: created.plan.id, p_expected_revision: paused.revision, p_definition: paused.definition,
      p_state: { ...paused.state, decisions: [{
        id: randomUUID(), kind: "schedule", decision: "accepted", recordedAt: new Date().toISOString(),
        ruleVersion: "test-rule-1", generatorVersion: "swim-rpc-test", inputSnapshot: { startDate: day(40) },
      }] },
      p_workouts: eligible.map((row, index) => ({
        id: row.id, expected_revision: row.revision, scheduled_date: day(40 + index),
        slot: row.slot, definition: row.definition,
      })),
    };
    expect((await alice.rpc("swim_resume_plan", { ...proposed, p_workouts: proposed.p_workouts.slice(0, 1) })).error).not.toBeNull();
    expect((await alice.rpc("swim_resume_plan", {
      ...proposed, p_workouts: [
        { ...proposed.p_workouts[0], id: missed.id, expected_revision: missed.revision },
        proposed.p_workouts[1],
      ],
    })).error).not.toBeNull();
    expect((await alice.rpc("swim_update_plan", {
      ...proposed, p_state: { ...proposed.p_state, pauseSnapshot: { ...paused.state.pauseSnapshot, workoutIds: [] } },
      p_workouts: [],
    })).error).not.toBeNull();
    const resumed = await rpc<SwimPlanWithWorkouts>(alice, "swim_resume_plan", proposed);
    expect(resumed.plan.status).toBe("active");
    expect(resumed.plan.ends_on).toBe(day(41));
    expect(resumed.plan.state.lifecycle).toHaveLength(2);
    expect(resumed.workouts.map((row) => row.scheduled_date)).toEqual([day(-1), day(40), day(41)]);
    expect(resumed.workouts.find((row) => row.id === missed.id)!.revision).toBe(missed.revision);
    expect(resumed.workouts.every((row) => row.definition.issued.totalLengths === 3)).toBe(true);
    expect((await alice.rpc("swim_resume_plan", proposed)).error?.code).toBe("40001");
  });

  it("rechecks active region and muscle limitations inside a direct start RPC", async () => {
    const created = await createPlan();
    const region = await alice.from("limitations").insert({
      user_id: aliceId, region: "shoulder_scapular", severity: "mild",
      allowed_movement_ids: [easyMovementId],
    }).select("id").single();
    expect(region.error).toBeNull();
    expect((await alice.rpc("swim_start_workout", {
      p_workout_id: created.workouts[0]!.id, p_expected_revision: 1,
    })).error).not.toBeNull();
    const untouched = await alice.from("swim_workouts").select("session_id,status,revision").eq("id", created.workouts[0]!.id).single();
    expect(untouched.data).toEqual({ session_id: null, status: "scheduled", revision: 1 });
    expect((await alice.from("limitations").update({ resolved_at: new Date().toISOString() }).eq("id", region.data!.id)).error).toBeNull();
    await start(created.workouts[0]!);
    const muscle = await alice.from("limitations").insert({
      user_id: aliceId, region: null, severity: "mild",
      affected_muscles: ["triceps"], allowed_movement_ids: [randomUUID()],
    }).select("id").single();
    expect(muscle.error).toBeNull();
    expect((await alice.rpc("swim_start_workout", {
      p_workout_id: created.workouts[1]!.id, p_expected_revision: 1,
    })).error).not.toBeNull();
    expect((await alice.from("limitations").update({ allowed_movement_ids: [easyMovementId] }).eq("id", muscle.data!.id)).error).toBeNull();
    await start(created.workouts[1]!);
    expect((await alice.from("limitations").update({ resolved_at: new Date().toISOString() }).eq("id", muscle.data!.id)).error).toBeNull();
  });

  it("uses the correct catalog movement and honors explicit movement allow-lists", async () => {
    expect(easyMovementId).not.toBe(intervalMovementId);
    const interval = prescription();
    const hardWorkout: SwimWorkout = {
      ...interval,
      sections: interval.sections.map((section) => section.kind === "main"
        ? { ...section, items: section.items.map((item) => ({ ...item, effort: "brisk" as const })) }
        : section),
    };
    const created = await rpc<SwimPlanWithWorkouts>(alice, "swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30), p_definition: planDefinition(), p_state: state(),
      p_workouts: [
        { scheduled_date: day(1), slot: "single", definition: definition() },
        { scheduled_date: day(2), slot: "single", definition: { version: 1, original: hardWorkout, issued: hardWorkout, modifications: [] } },
      ],
    });
    const blocked = await alice.from("limitations").insert({
      user_id: aliceId, region: null, severity: "mild",
      affected_movement_ids: [easyMovementId],
    }).select("id").single();
    expect(blocked.error).toBeNull();
    expect((await alice.rpc("swim_start_workout", {
      p_workout_id: created.workouts[0]!.id, p_expected_revision: 1,
    })).error).not.toBeNull();
    await start(created.workouts[1]!);
    expect((await alice.from("limitations").update({ allowed_movement_ids: [easyMovementId] }).eq("id", blocked.data!.id)).error).toBeNull();
    await start(created.workouts[0]!);
    expect((await alice.from("limitations").update({ resolved_at: new Date().toISOString() }).eq("id", blocked.data!.id)).error).toBeNull();
  });

  it("DC-SW9 does not let a pull buoy remove the kick set's active foot-region restriction", async () => {
    const base = prescription();
    function withBuoy(stroke: "kick" | "freestyle"): SwimWorkoutDefinition {
      const workout: SwimWorkout = {
        ...base,
        snapshot: { ...base.snapshot, strokes: [stroke], equipment: ["pull_buoy"] },
        sections: base.sections.map((section) => ({
          ...section, items: section.items.map((item) => ({ ...item, stroke, equipment: ["pull_buoy"] })),
        })),
      };
      return { version: 1, original: workout, issued: workout, modifications: [] };
    }
    const setup = planDefinition();
    const created = await rpc<SwimPlanWithWorkouts>(alice, "swim_create_plan", {
      p_started_on: day(1), p_ends_on: day(30),
      p_definition: { ...setup, setup: { ...setup.setup, equipment: ["pull_buoy"], knownStrokes: ["freestyle", "kick"] } },
      p_state: state(),
      p_workouts: [
        { scheduled_date: day(1), slot: "single", definition: withBuoy("kick") },
        { scheduled_date: day(2), slot: "single", definition: withBuoy("freestyle") },
      ],
    });
    const limitation = await alice.from("limitations").insert({
      user_id: aliceId, region: "foot_ankle_calf", severity: "mild",
      allowed_movement_ids: [easyMovementId],
    }).select("id").single();
    expect(limitation.error).toBeNull();
    try {
      expect((await alice.rpc("swim_start_workout", {
        p_workout_id: created.workouts[0]!.id, p_expected_revision: 1,
      })).error).not.toBeNull();
      const untouched = await alice.from("swim_workouts").select("session_id,status,revision")
        .eq("id", created.workouts[0]!.id).single();
      expect(untouched.error).toBeNull();
      expect(untouched.data).toEqual({ session_id: null, status: "scheduled", revision: 1 });
      await start(created.workouts[1]!);
    } finally {
      expect((await alice.from("limitations").update({ resolved_at: new Date().toISOString() })
        .eq("id", limitation.data!.id)).error).toBeNull();
    }
  });

  it("invalidates proposal revisions after trash, undo, date edits and hard purge", async () => {
    const created = await createPlan();
    const started = await start(created.workouts[0]!);
    await rpc(alice, "swim_complete_workout", completionArgs(started));
    async function revision() {
      const current = await alice.from("swim_plans").select("revision").eq("id", created.plan.id).single();
      if (current.error) throw new Error(current.error.message);
      return current.data.revision as number;
    }
    const before = await revision();
    expect(before).toBe(3);
    await bob.from("sessions").update({ deleted_at: new Date().toISOString() }).eq("id", started.session_id!);
    expect(await revision()).toBe(before);
    expect((await alice.from("sessions").update({ deleted_at: new Date().toISOString() }).eq("id", started.session_id!)).error).toBeNull();
    expect(await revision()).toBe(before + 1);
    const stale = await alice.rpc("swim_update_plan", {
      p_plan_id: created.plan.id, p_expected_revision: before,
      p_definition: created.plan.definition, p_state: created.plan.state, p_workouts: [],
    });
    expect(stale.error?.code).toBe("40001");
    expect((await alice.from("sessions").update({ deleted_at: null }).eq("id", started.session_id!)).error).toBeNull();
    expect(await revision()).toBe(before + 2);
    expect((await alice.from("sessions").update({ performed_at: `${day(-1)}T12:00:00Z` }).eq("id", started.session_id!)).error).toBeNull();
    expect(await revision()).toBe(before + 3);
    expect((await alice.from("sessions").delete().eq("id", started.session_id!)).error).toBeNull();
    expect(await revision()).toBe(before + 4);
  });

  it("invalidates administrator bulk purge with NULL auth.uid without touching another owner", async () => {
    const older = await createPlan();
    const archived = await rpc<{ revision: number }>(alice, "swim_set_plan_status", {
      p_plan_id: older.plan.id, p_expected_revision: older.plan.revision, p_status: "archived",
    });
    const created = await createPlan();
    const other = await createPlan(bob);
    const started = await Promise.all(created.workouts.map((workout) => start(workout)));
    const before = await alice.from("swim_plans").select("revision").eq("id", created.plan.id).single();
    expect(before.error).toBeNull();
    expect((await admin.from("sessions").delete().in("id", started.map((workout) => workout.session_id!))).error).toBeNull();
    const [ownPlan, olderPlan, otherPlan, workouts] = await Promise.all([
      alice.from("swim_plans").select("revision").eq("id", created.plan.id).single(),
      alice.from("swim_plans").select("revision").eq("id", older.plan.id).single(),
      bob.from("swim_plans").select("revision").eq("id", other.plan.id).single(),
      alice.from("swim_workouts").select("user_id,session_id,revision,definition").eq("plan_id", created.plan.id),
    ]);
    expect(ownPlan.error).toBeNull();
    expect(olderPlan.error).toBeNull();
    expect(otherPlan.error).toBeNull();
    expect(workouts.error).toBeNull();
    expect(ownPlan.data!.revision).toBe(before.data!.revision + 1);
    // Purge clears the only session link before this statement trigger runs:
    // conservative invalidation includes this owner's unrelated archived plan.
    expect(olderPlan.data!.revision).toBe(archived.revision + 1);
    expect(otherPlan.data!.revision).toBe(other.plan.revision);
    expect(workouts.data).toHaveLength(2);
    for (const workout of workouts.data!) {
      expect(workout.user_id).toBe(aliceId);
      expect(workout.session_id).toBeNull();
      expect(workout.revision).toBe(3);
      expect(workout.definition.original).toEqual(definition().original);
    }
    for (const client of [alice, admin]) {
      expect((await client.rpc("swim_invalidate_session_source")).error).not.toBeNull();
    }
  });

  it("races a bulk purge against existing-session completion and edits without deadlocks or retries", async () => {
    const created = await createPlan(alice, [1, 2, 3, 4, 5, 6, 7, 8]);
    const started = await Promise.all(created.workouts.map((workout) => start(workout)));
    const completed = await Promise.all(started.slice(0, 4).map((workout) =>
      rpc<SwimCompletion>(alice, "swim_complete_workout", completionArgs(workout))));
    const sessionIds = started.map((workout) => workout.session_id!);
    const [purge, ...mutations] = await Promise.all([
      admin.from("sessions").delete().in("id", sessionIds),
      ...completed.map((row) => alice.rpc("swim_edit_result", {
        p_workout_id: row.workout.id, p_expected_revision: row.workout.revision,
        p_result: { ...result(), timeMs: 210_005 },
      })),
      ...started.slice(4).map((workout) => alice.rpc("swim_complete_workout", completionArgs(workout))),
    ]);
    expect(purge.error).toBeNull();
    for (const mutation of mutations) {
      expect(mutation.error?.code).not.toBe("40P01");
      // Either the native mutation committed first, or purge removed its session.
      if (mutation.error) expect(mutation.error.message).toMatch(/not found|before completing/);
    }
    const [sessions, logs, workouts] = await Promise.all([
      alice.from("sessions").select("id").in("id", sessionIds),
      alice.from("cardio_logs").select("id").in("session_id", sessionIds),
      alice.from("swim_workouts").select("session_id,definition").eq("plan_id", created.plan.id),
    ]);
    expect(sessions.error).toBeNull();
    expect(logs.error).toBeNull();
    expect(workouts.error).toBeNull();
    expect(sessions.data).toHaveLength(0);
    expect(logs.data).toHaveLength(0);
    expect(workouts.data).toHaveLength(8);
    for (const workout of workouts.data!) {
      expect(workout.session_id).toBeNull();
      expect(workout.definition.original).toEqual(definition().original);
      expect(workout.definition.resultHistory).toBeUndefined();
    }
  });

  it("rejects a generic native-row edit without inverting the result editor's locks", async () => {
    const started = await start((await createPlan()).workouts[0]!);
    const completed = await rpc<SwimCompletion>(alice, "swim_complete_workout", completionArgs(started));
    const [native, generic] = await Promise.all([
      alice.rpc("swim_edit_result", {
        p_workout_id: started.id, p_expected_revision: completed.workout.revision,
        p_result: { ...result(), timeMs: 210_005 },
      }),
      alice.from("cardio_logs").update({ notes: "Bypass" }).eq("id", completed.cardio_log_id),
    ]);
    expect(native.error).toBeNull();
    expect(generic.error).not.toBeNull();
    expect(generic.error?.code).not.toBe("40P01");
  });
});
