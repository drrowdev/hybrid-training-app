import { openSwimProgramActions, openSwimProgramHistory } from "./fixtures/swim-navigation";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { errors, type Page, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { ALL_REGIONS, finalEwma, type Region, type SwimActualResult } from "@hta/domain";
import { test as seededTest, expect, type SeedConfig } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedSwimPrimaryBaseline } from "./fixtures/swim-primary";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd, todayYmd, ymdInTimezone } from "../src/lib/dates";
import { structuredSwimRegions } from "../src/lib/swim/load";
import { cardioIntensityScalar, normaliseHrZones } from "../src/lib/engine/cardio-intensity";
import { CARDIO_LOAD_SCALAR, PRIMARY_REGION_WEIGHT, SECONDARY_REGION_WEIGHT } from "../src/lib/engine/set-load";
import type { SwimPlanRow, SwimWorkoutRow } from "../src/lib/swim/storage";
import { countsTowardAdherence, countsTowardHistory, countsTowardProgression } from "@hta/domain";
import { deriveDailyRegionLoad } from "../src/lib/engine/region-daily-load";
import { deriveSwimWeekCandidate, loadSwimHistory, settledSwimResult } from "../src/lib/swim/queries";
import { isUuid } from "../src/lib/offline/outbox-core";
import {
  SWIM_ALERT_CODEBOOK, alertAnnotation, classifyAlertNodes, pauseBackend,
  unavailableAlert, validateAlertCategory,
} from "../scripts/swim-alert-membership";
import { summarizeSwimWeek } from "@hta/domain";
import { loadSwimHubView } from "../src/lib/swim/queries";
import { mondayOfYmd } from "../src/lib/dates";
import { swimWorkoutExposure } from "@hta/domain";
import { ALL_MUSCLE_GROUPS } from "../src/lib/muscle/muscle-groups";
import { MUSCLE_TO_REGION, REGIONS } from "../src/lib/limitations/region";
import { REGION_LABELS } from "../src/lib/settings/limitations-constants";
import { retainedSwimActor, completeRetainedSwim } from "./fixtures/swim-retained";
import { startSwimWorkout, editSwimResult } from "../src/lib/swim/storage";
import { recomputeRegionState } from "../src/lib/engine/region-ledger";
import { loadTrainingSchedule } from "../src/lib/schedule/storage";

const test = seededTest.extend({
  // Match the persistence spec: reject unsafe targets before any fixture writes.
  seedConfig: async ({ baseURL }, use) => {
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1") {
      throw new Error("Swimming lifecycle tests require the disposable loopback environment.");
    }
    if (!baseURL || !URL.canParse(baseURL) || process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
      throw new Error("Swimming lifecycle tests require an explicit loopback HTTP baseURL.");
    }
    const target = new URL(baseURL);
    if (target.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Swimming lifecycle tests require an explicit loopback HTTP baseURL.");
    }
    const {
      E2E_SUPABASE_URL: supabaseUrl,
      E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Swimming lifecycle tests require explicit dedicated seed configuration.");
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
  freshUser: async ({ admin }, use) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    if (!created.data.user) throw new Error("Missing synthetic user.");
    const userId = created.data.user.id;
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use({ email, password, userId });
    } finally {
      // Checked cleanup matches swimming-persistence-mobile.spec.ts.
      const deleted = await admin.auth.admin.deleteUser(userId);
      expect(deleted.error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user).toBeNull();
      expect(remaining.error?.status).toBe(404);
    }
  },
});

async function createPlan(page: Page) {
  await page.goto("/app/swim/setup");
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
  await page.getByLabel("Recent comfortable non-stop lengths", { exact: true }).fill("4");
  await page.getByLabel("Weeks", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Preview plan", exact: true }).click();
  await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/swim\?plan=[^&]+$/);
  await expect(page.getByRole("heading", { name: "Swims", exact: true })).toBeVisible();
  const planId = new URL(page.url()).searchParams.get("plan");
  if (!planId) throw new Error("Missing created plan ID.");
  return { url: page.url(), planId };
}

async function savedPlan(admin: SupabaseClient, userId: string, planId: string) {
  const [plan, workouts] = await Promise.all([
    admin.from("swim_plans").select("*").eq("user_id", userId).eq("id", planId)
      .single<SwimPlanRow>(),
    admin.from("swim_workouts").select("*").eq("user_id", userId).eq("plan_id", planId)
      .order("scheduled_date").order("id").returns<SwimWorkoutRow[]>(),
  ]);
  expect(plan.error).toBeNull();
  expect(workouts.error).toBeNull();
  if (!plan.data || !workouts.data) throw new Error("Missing saved swimming rows.");
  expect(workouts.data).toHaveLength(4);
  return { plan: plan.data, workouts: workouts.data };
}

async function confirmPlanStatus(
  admin: SupabaseClient, userId: string, planId: string,
  status: "finished" | "archived", deadline: number,
) {
  const budget = deadline - performance.now();
  if (budget <= 0) return "not-confirmed-expired" as const;
  const controller = new AbortController();
  const expiry = setTimeout(() => controller.abort(), budget);
  const active = () => !controller.signal.aborted && performance.now() < deadline;
  const polling = (async () => {
    const intervals = [100, 250, 500, 1000];
    let attempt = 0;
    while (active()) {
      const sample = await admin.from("swim_plans").select("id,user_id,status")
        .eq("user_id", userId).eq("id", planId).abortSignal(controller.signal).single();
      if (!active()) return "not-confirmed-expired" as const;
      if (sample.error || !sample.data || sample.data.id !== planId || sample.data.user_id !== userId ||
        !["active", "paused", "finished", "archived"].includes(sample.data.status)) {
        return "read-error" as const;
      }
      if (sample.data.status === status) return "reached" as const;
      const remaining = deadline - performance.now();
      if (remaining <= 0) return "not-confirmed-expired" as const;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, Math.min(intervals[Math.min(attempt++, intervals.length - 1)], remaining));
        controller.signal.addEventListener("abort", finish, { once: true });
      });
    }
    return "not-confirmed-expired" as const;
  })().catch(() => active() ? "read-error" as const : "not-confirmed-expired" as const);
  try {
    return await polling;
  } finally {
    controller.abort();
    clearTimeout(expiry);
    await Promise.allSettled([polling]);
  }
}

async function primaryBaseline(admin: SupabaseClient, user: { userId: string; email: string; password: string }, config: SeedConfig) {
  const userId = user.userId;
  const actor = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await actor.auth.signInWithPassword(user);
  expect(signed.error).toBeNull();
  expect(signed.data.user?.id).toBe(userId);
  const timezone = await userTimezone(admin, userId);
  const movement = await admin.from("movements").select("id,display_name")
    .is("user_id", null).eq("slug", "bench-press-flat").single();
  expect(movement.error).toBeNull();
  if (typeof movement.data?.id !== "string" || !movement.data.id.trim() ||
    typeof movement.data.display_name !== "string" || !movement.data.display_name.trim()) {
    throw new Error("Missing valid global bench-press-flat catalog movement.");
  }
  const movementId = movement.data.id;
  const prescription: Prescription = {
    items: [{ movementId, movementName: movement.data.display_name, kind: "main", sets: 3, reps: 5 }],
  };
  const { blockId, plannedIds } = await seedSwimPrimaryBaseline(actor, userId, addDaysToYmd(todayYmd(timezone), -7), prescription);
  const linked = await admin.from("planned_sessions").select("completed_session_id")
    .eq("user_id", userId).eq("id", plannedIds[0]).single();
  expect(linked.error).toBeNull();
  const sessionId = linked.data?.completed_session_id as string | null;
  if (!sessionId) throw new Error("Missing primary session.");
  const set = await admin.from("set_logs").insert({
    session_id: sessionId, movement_id: movementId, set_index: 1,
    weight_kg: 40, reps: 5, rpe: 7, set_kind: "main", skipped: false,
  });
  expect(set.error).toBeNull();
  async function snapshot() {
    const rows = await Promise.all([
      admin.from("training_blocks").select("*").eq("user_id", userId).eq("id", blockId),
      admin.from("planned_sessions").select("*").eq("user_id", userId).eq("block_id", blockId).order("id"),
      admin.from("sessions").select("*").eq("user_id", userId).eq("id", sessionId),
      admin.from("set_logs").select("*").eq("session_id", sessionId).order("id"),
      admin.from("movements").select("*").is("user_id", null).eq("slug", "bench-press-flat").eq("id", movementId),
    ]);
    for (const [index, result] of rows.entries()) {
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(index === 1 ? 2 : 1);
    }
    return rows.map((result) => result.data);
  }
  return { snapshot, initial: await snapshot() };
}

function lifecycleTransition(before: SwimPlanRow, after: SwimPlanRow, status: SwimPlanRow["status"]) {
  expect(after.status).toBe(status);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.definition).toEqual(before.definition);
  expect(after.state.lifecycle).toEqual([
    ...(before.state.lifecycle ?? []),
    { from: before.status, to: status, recordedAt: expect.any(String) },
  ]);
  expect(Number.isFinite(Date.parse(after.state.lifecycle!.at(-1)!.recordedAt))).toBe(true);
}

async function userTimezone(admin: SupabaseClient, userId: string) {
  const profile = await admin.from("profiles").select("timezone").eq("id", userId).single();
  expect(profile.error).toBeNull();
  if (typeof profile.data?.timezone !== "string") throw new Error("Missing synthetic user's timezone.");
  return profile.data.timezone;
}

type NativeSession = {
  id: string; user_id: string; performed_at: string; completed_at: string | null;
  deleted_at: string | null; completion_outbox_entry_id: string | null;
  duration_min: number | null; session_rpe: number | string | null;
};
type NativeLog = {
  id: string; session_id: string; client_log_id: string | null; modality: string;
  duration_sec: number; distance_km: number | string; rpe: number | string | null;
  hr_zones: unknown; swim_result: SwimActualResult;
};
type RegionRow = {
  user_id: string; region: Region; atl: number | string; ctl: number | string;
  baseline_tolerance: number | string; last_load_date: string | null; updated_at: string;
};

async function nativeRows(admin: SupabaseClient, userId: string, sessionId: string, signal?: AbortSignal) {
  const sessionQuery = admin.from("sessions")
    .select("id,user_id,performed_at,completed_at,deleted_at,completion_outbox_entry_id,duration_min,session_rpe")
    .eq("user_id", userId).eq("id", sessionId);
  const logsQuery = admin.from("cardio_logs")
    .select("id,session_id,client_log_id,modality,duration_sec,distance_km,rpe,hr_zones,swim_result")
    .eq("session_id", sessionId).returns<NativeLog[]>();
  const reads = [
    (signal ? sessionQuery.abortSignal(signal) : sessionQuery).single<NativeSession>(),
    signal ? logsQuery.abortSignal(signal) : logsQuery,
  ] as const;
  const [session, logs] = signal ? await Promise.allSettled(reads).then(([session, logs]) => {
    if (session.status === "rejected") throw session.reason;
    if (logs.status === "rejected") throw logs.reason;
    return [session.value, logs.value] as const;
  }) : await Promise.all(reads);
  expect(session.error).toBeNull();
  expect(logs.error).toBeNull();
  if (!session.data || !logs.data) throw new Error("Missing native session rows.");
  expect(session.data.id).toBe(sessionId);
  expect(session.data.user_id).toBe(userId);
  return { session: session.data, logs: logs.data };
}

async function regionRows(admin: SupabaseClient, userId: string) {
  const result = await admin.from("region_state")
    .select("user_id,region,atl,ctl,baseline_tolerance,last_load_date,updated_at")
    .eq("user_id", userId).order("region").returns<RegionRow[]>();
  expect(result.error).toBeNull();
  if (!result.data) throw new Error("Missing region query result.");
  return result.data;
}

function assertLedger(
  rows: RegionRow[], userId: string, timezone: string, session: NativeSession,
  log: NativeLog, previous: RegionRow[] = [],
) {
  expect(rows.map((row) => row.region).sort()).toEqual([...ALL_REGIONS].sort());
  const exposure = structuredSwimRegions(log.swim_result);
  if (!exposure) throw new Error("Expected native swimming exposure.");
  const day = ymdInTimezone(new Date(session.performed_at), timezone);
  const load = log.duration_sec / 60 * cardioIntensityScalar({
    hrZones: normaliseHrZones(log.hr_zones), durationSec: log.duration_sec,
    rpe: log.rpe === null ? null : Number(log.rpe),
  }) * CARDIO_LOAD_SCALAR;
  expect(load).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.user_id).toBe(userId);
    const updated = Date.parse(row.updated_at);
    expect(Number.isFinite(updated)).toBe(true);
    expect(updated).toBeGreaterThanOrEqual(Date.parse(session.performed_at));
    const old = previous.find((value) => value.region === row.region);
    if (old) expect(updated).toBeGreaterThan(Date.parse(old.updated_at));
    // Attribute the actual session instant, not its planned swim date. Compare
    // the once-only lower-level EWMA to the persisted numeric(10,4) values.
    const asOf = ymdInTimezone(new Date(row.updated_at), timezone);
    expect(asOf >= day).toBe(true);
    const weight = (exposure.primaryRegions.includes(row.region) ? PRIMARY_REGION_WEIGHT : 0) +
      (exposure.secondaryRegions.includes(row.region) ? SECONDARY_REGION_WEIGHT : 0);
    const series = new Map<string, number>(weight > 0 ? [[day, load * weight]] : []);
    const atl = Number(finalEwma(series, day, asOf, 7).toFixed(4));
    const ctl = Number(finalEwma(series, day, asOf, 28).toFixed(4));
    expect(Number(row.atl)).toBe(atl);
    expect(Number(row.ctl)).toBe(ctl);
    expect(Number(row.baseline_tolerance)).toBe(ctl);
    expect(row.last_load_date).toBe(weight > 0 ? day : null);
  }
}

async function lifecycleState(admin: SupabaseClient, userId: string) {
  const [plans, workouts, sessions, regions, blocks, planned] = await Promise.all([
    admin.from("swim_plans").select("*").eq("user_id", userId).order("id").returns<SwimPlanRow[]>(),
    admin.from("swim_workouts").select("*").eq("user_id", userId).order("scheduled_date").order("id").returns<SwimWorkoutRow[]>(),
    admin.from("sessions").select("*").eq("user_id", userId).order("id"),
    admin.from("region_state").select("*").eq("user_id", userId).order("region").returns<RegionRow[]>(),
    admin.from("training_blocks").select("*").eq("user_id", userId).order("id"),
    admin.from("planned_sessions").select("*").eq("user_id", userId).order("id"),
  ]);
  expect([plans, workouts, sessions, regions, blocks, planned].every((row) =>
    row.error === null && Array.isArray(row.data))).toBe(true);
  const sessionIds = sessions.data!.map((row) => row.id);
  const [logs, sets] = await Promise.all([
    admin.from("cardio_logs").select("*").in("session_id", sessionIds).order("id"),
    admin.from("set_logs").select("*,movement:movements(primary_region,secondary_regions)")
      .in("session_id", sessionIds).order("id"),
  ]);
  expect(logs.error === null && sets.error === null && !!logs.data && !!sets.data).toBe(true);
  return {
    plans: plans.data!, workouts: workouts.data!, sessions: sessions.data!, regions: regions.data!,
    blocks: blocks.data!, planned: planned.data!, logs: logs.data!, sets: sets.data!,
    history: await loadSwimHistory(admin, workouts.data!),
  };
}

function lifecycleLedger(state: Awaited<ReturnType<typeof lifecycleState>>, timezone: string) {
  const completed = state.sessions.filter((row) => row.completed_at && !row.deleted_at);
  const performed = new Map(completed.map((row) => [row.id, row.performed_at as string]));
  const firstDate = completed.map((row) => ymdInTimezone(new Date(row.performed_at), timezone)).sort()[0];
  expect(typeof firstDate === "string").toBe(true);
  const daily = deriveDailyRegionLoad({
    userTz: timezone,
    sets: state.sets.filter((row) => performed.has(row.session_id)).map((row) => ({
      performedAt: performed.get(row.session_id)!, weightKg: row.weight_kg, reps: row.reps,
      rpe: row.rpe, setKind: row.set_kind, skipped: row.skipped, movement: row.movement,
    })),
    cardio: state.logs.filter((row) => performed.has(row.session_id)).map((row) => ({
      performedAt: performed.get(row.session_id)!, durationSec: row.duration_sec, rpe: row.rpe,
      modality: row.modality, hrZones: row.hr_zones, swimResult: row.swim_result, movement: null,
    })),
  });
  expect(isDeepStrictEqual(state.regions.map((row) => row.region).sort(), [...ALL_REGIONS].sort())).toBe(true);
  for (const row of state.regions) {
    const series = daily.get(row.region)!;
    expect(Number.isFinite(Date.parse(row.updated_at))).toBe(true);
    const asOf = ymdInTimezone(new Date(row.updated_at), timezone);
    const atl = Number(finalEwma(series, firstDate, asOf, 7).toFixed(4));
    const ctl = Number(finalEwma(series, firstDate, asOf, 28).toFixed(4));
    const last = [...series].filter(([, load]) => load > 0).map(([day]) => day).sort().at(-1) ?? null;
    expect(isDeepStrictEqual(
      [Number(row.atl), Number(row.ctl), Number(row.baseline_tolerance), row.last_load_date],
      [atl, ctl, ctl, last],
    )).toBe(true);
  }
}

test.describe("ADR0079 mobile swimming lifecycle and regional load", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });
  test.skip(!swimE2EEnabled(process.env), "Blocked: swimming E2E was not explicitly requested.");

  test("A1, DC-SW7: pause, review, resume, finish and archive preserve retained swims and primary training", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }, testInfo) => {
    await markOnboarded(admin, freshUser.userId);
    const primary = await primaryBaseline(admin, freshUser, seedConfig);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const { url, planId } = await createPlan(page);
    const created = await savedPlan(admin, freshUser.userId, planId);
    expect(created.plan.status).toBe("active");
    expect(created.plan.revision).toBeGreaterThan(0);
    expect(created.plan.state.lifecycle ?? []).toEqual([]);
    for (const row of created.workouts) {
      expect(row.status).toBe("scheduled");
      expect(row.session_id).toBeNull();
      expect(row.definition.issued.totalLengths).toBeGreaterThan(0);
    }
    expect(await primary.snapshot()).toEqual(primary.initial);
    const first = created.workouts[0];
    const actor = await retainedSwimActor(seedConfig, freshUser);
    await startSwimWorkout(actor, first.id, first.revision);
    const started = await savedPlan(admin, freshUser.userId, planId);
    const protectedSwim = started.workouts.find((row) => row.id === first.id)!;
    expect(protectedSwim.status).toBe("started");
    expect(protectedSwim.session_id).toEqual(expect.any(String));
    expect(protectedSwim.revision).toBe(first.revision + 1);
    expect(protectedSwim.definition).toEqual(first.definition);
    expect(protectedSwim.scheduled_date).toBe(first.scheduled_date);
    expect(started.plan.revision).toBe(created.plan.revision + 1);
    expect(started.plan.state).toEqual(created.plan.state);
    expect(await primary.snapshot()).toEqual(primary.initial);
    await page.goto(url);
    const { origin, pathname } = new URL(page.url());
    let actionRequest: Request | undefined;
    const requestWaiter = page.waitForRequest((request) => {
      if (actionRequest || request.method() !== "POST") return false;
      const target = new URL(request.url());
      if (target.origin !== origin || target.pathname !== pathname ||
        !request.headers()["next-action"]) return false;
      actionRequest = request;
      return true;
    }, { timeout: 5000 }).then(
      () => "seen" as const,
      (error: unknown) => error instanceof errors.TimeoutError ? "timeout" as const : "error" as const,
    );
    const responseWaiter = page.waitForResponse(
      (response) => actionRequest !== undefined && response.request() === actionRequest,
      { timeout: 5000 },
    ).then(
      (response) => ({ outcome: "seen", paired: response.request() === actionRequest, status: response.status() }),
      (error: unknown) => ({
        outcome: error instanceof errors.TimeoutError ? "timeout" : "error", paired: false, status: null,
      }),
    );
    await openSwimProgramActions(page);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const deadline = performance.now() + 5000;
    expect(deadline - performance.now()).toBeGreaterThan(0);
    const requestOutcome = await requestWaiter;
    expect(requestOutcome).toBe("seen");
    expect(deadline - performance.now()).toBeGreaterThan(0);
    const responseOutcome = await responseWaiter;
    expect(responseOutcome.outcome).toBe("seen");
    expect(responseOutcome.paired).toBe(true);
    expect(responseOutcome.status).toBe(200);

    const backendBudget = deadline - performance.now();
    expect(backendBudget).toBeGreaterThan(0);
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const diagnostic = unavailableAlert("a1-pause");
    try {
      // Bound polling and the late sample without a sleep or a renewed deadline.
      const expired = new Promise<"pending">((resolve) => {
        expiry = setTimeout(() => resolve("pending"), backendBudget);
      });
      const captureAlert = async () => {
        if (performance.now() >= deadline) return;
        const category = await Promise.race([
          page.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)
            .then(({ category }) => category).then(validateAlertCategory, () => "unavailable" as const),
          expired.then(() => "unavailable" as const),
        ]);
        diagnostic.category = performance.now() < deadline ? category : "unavailable";
      };
      const polling = (async () => {
        while (performance.now() < deadline) {
          const { count } = await page.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK);
          if (count < 0) return "error" as const;
          if (count > 0) return "alert" as const;
          if (performance.now() >= deadline) return "pending" as const;
          const saved = await savedPlan(admin, freshUser.userId, planId);
          if (performance.now() >= deadline) return "pending" as const;
          if (saved.plan.status === "paused") {
            Object.assign(diagnostic, pauseBackend(saved.plan.status, saved.plan.revision, started.plan.revision));
            return "backend" as const;
          }
        }
        return "pending" as const;
      })().then(
        (outcome) => outcome,
        () => "error" as const,
      );
      const backendOutcome = await Promise.race([polling, expired]);
      if (backendOutcome === "alert" && performance.now() < deadline) {
        const controller = new AbortController();
        void expired.then(() => controller.abort());
        try {
          // Diagnostic read only: keep the owned goal even when alert won the poll.
          await Promise.race([
            Promise.all([
              captureAlert(),
              (async () => {
                const sample = await admin.from("swim_plans").select("status,revision")
                  .eq("user_id", freshUser.userId).eq("id", planId).abortSignal(controller.signal).single();
                if (performance.now() < deadline && !sample.error && sample.data) {
                  Object.assign(diagnostic, pauseBackend(sample.data.status, sample.data.revision, started.plan.revision));
                }
              })().catch(() => undefined),
            ]),
            expired,
          ]);
        } finally { controller.abort(); }
      }
      expect(backendOutcome).not.toBe("error");
      expect(backendOutcome).not.toBe("alert");
      expect(backendOutcome).toBe("backend");
      const visibilityBudget = deadline - performance.now();
      expect(visibilityBudget).toBeGreaterThan(0);
      await expect(page.getByTestId("page-header").getByText("Paused program · Swimming", { exact: true })).toBeVisible({ timeout: visibilityBudget });
      expect(deadline - performance.now()).toBeGreaterThan(0);
      // One late sample, not continuous alert coverage during rendering.
      const lateAlertCount = await Promise.race([
        page.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)
          .then(({ count }) => count, () => "error" as const),
        expired,
      ]);
      if (typeof lateAlertCount === "number" && performance.now() < deadline) {
        if (lateAlertCount !== 0) await captureAlert();
        else diagnostic.category = "absent";
      }
      expect(lateAlertCount).toBe(0);
    } finally {
      clearTimeout(expiry);
      const annotation = alertAnnotation(diagnostic);
      if (annotation) testInfo.annotations.push(annotation);
    }
    const paused = await savedPlan(admin, freshUser.userId, planId);
    lifecycleTransition(started.plan, paused.plan, "paused");
    expect(paused.workouts).toEqual(started.workouts);
    const future = paused.workouts.filter((row) => row.id !== first.id);
    expect(future).toHaveLength(3);
    const today = await page.getByLabel("Resume from", { exact: true }).getAttribute("min");
    if (!today) throw new Error("Missing server-local resume minimum.");
    for (const row of future) {
      expect(row.status).toBe("scheduled");
      expect(row.session_id).toBeNull();
      expect(row.scheduled_date >= today).toBe(true);
    }
    expect(paused.plan.state.pauseSnapshot?.workoutIds).toEqual(future.map((row) => row.id));
    expect(await primary.snapshot()).toEqual(primary.initial);
    const resumeFrom = addDaysToYmd(paused.plan.ends_on > today ? paused.plan.ends_on : today, 1);
    await page.getByLabel("Resume from", { exact: true }).fill(resumeFrom);
    const previewDates = page.getByRole("button", { name: "Preview dates", exact: true });
    const previewDeadline = performance.now() + 5_000;
    const previewCountBudget = previewDeadline - performance.now();
    expect(previewCountBudget).toBeGreaterThan(0);
    await expect(previewDates).toHaveCount(1, { timeout: previewCountBudget });
    const previewVisibleBudget = previewDeadline - performance.now();
    expect(previewVisibleBudget).toBeGreaterThan(0);
    await expect(previewDates).toBeVisible({ timeout: previewVisibleBudget });
    const previewEnabledBudget = previewDeadline - performance.now();
    expect(previewEnabledBudget).toBeGreaterThan(0);
    await expect(previewDates).toBeEnabled({ timeout: previewEnabledBudget });
    const previewClickBudget = previewDeadline - performance.now();
    expect(previewClickBudget).toBeGreaterThan(0);
    await previewDates.click({ timeout: previewClickBudget });
    const preview = page.getByRole("heading", { name: "New swim dates", exact: true }).locator("..");
    await expect(preview.getByRole("listitem")).toHaveCount(future.length);
    const dates = await preview.getByRole("listitem").allTextContents();
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date >= resumeFrom).toBe(true);
    }
    expect(await savedPlan(admin, freshUser.userId, planId)).toEqual(paused);
    expect(await primary.snapshot()).toEqual(primary.initial);
    await page.getByRole("button", { name: "Accept dates and resume", exact: true }).click();
    await expect(page.getByTestId("page-header").getByText("Active program · Swimming", { exact: true })).toBeVisible();
    const resumed = await savedPlan(admin, freshUser.userId, planId);
    lifecycleTransition(paused.plan, resumed.plan, "active");
    expect(resumed.workouts.find((row) => row.id === first.id)).toEqual(protectedSwim);
    for (const [index, row] of future.entries()) {
      expect(resumed.workouts.find((saved) => saved.id === row.id)).toEqual({
        ...row, scheduled_date: dates[index], revision: row.revision + 1, updated_at: expect.any(String),
      });
    }
    expect(resumed.plan.state.decisions).toHaveLength(paused.plan.state.decisions.length + 1);
    expect(resumed.plan.state.decisions.slice(0, -1)).toEqual(paused.plan.state.decisions);
    expect(resumed.plan.state.decisions.at(-1)).toMatchObject({ kind: "schedule", decision: "accepted" });
    expect(resumed.plan.state.pauseSnapshot).toEqual(paused.plan.state.pauseSnapshot);
    expect(resumed.plan.ends_on).toBe([...dates, paused.plan.ends_on].sort().at(-1));
    expect(await primary.snapshot()).toEqual(primary.initial);
    let previous = resumed;
    {
      await openSwimProgramActions(page);

      await page.getByRole("button", { name: "Finish plan", exact: true }).click();
      const deadline = performance.now() + 5000;
      const outcome = await confirmPlanStatus(admin, freshUser.userId, planId, "finished", deadline);
      expect(outcome).not.toBe("read-error");
      expect(outcome).toBe("reached");
      const remaining = deadline - performance.now();
      expect(remaining).toBeGreaterThan(0);
      await expect(page.getByTestId("page-header").getByText("Finished program · Swimming", { exact: true })).toBeVisible({ timeout: remaining });
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, "finished");
      expect(saved.workouts).toEqual(resumed.workouts);
      expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);
      expect(await primary.snapshot()).toEqual(primary.initial);
      previous = saved;
    }
    {
      await openSwimProgramActions(page);

      await page.getByRole("button", { name: "Archive", exact: true }).click();
      const deadline = performance.now() + 5000;
      const outcome = await confirmPlanStatus(admin, freshUser.userId, planId, "archived", deadline);
      expect(outcome).not.toBe("read-error");
      expect(outcome).toBe("reached");
      const remaining = deadline - performance.now();
      expect(remaining).toBeGreaterThan(0);
      await expect(page.getByTestId("page-header").getByText("Archived program · Swimming", { exact: true })).toBeVisible({ timeout: remaining });
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, "archived");
      expect(saved.workouts).toEqual(resumed.workouts);
      expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);
      expect(await primary.snapshot()).toEqual(primary.initial);
      previous = saved;
    }
    await page.reload();
    await expect(page.getByTestId("page-header").getByText("Archived program · Swimming", { exact: true })).toBeVisible();
    expect(await savedPlan(admin, freshUser.userId, planId)).toEqual(previous);
    expect(await primary.snapshot()).toEqual(primary.initial);
  });

  test("A2, DC-SW9: trash and recovery of retained edited results remove and restore regional load exactly once", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    expect(await regionRows(admin, userId)).toEqual([]);
    const { planId } = await createPlan(page);
    const scheduled = await savedPlan(admin, userId, planId);
    const workout = scheduled.workouts[0];
    const actor = await retainedSwimActor(seedConfig, freshUser);
    await startSwimWorkout(actor, workout.id, workout.revision);
    const started = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)!;
    expect(started.status).toBe("started");
    const sessionId = started.session_id;
    if (!sessionId) throw new Error("Missing started native session ID.");
    const before = await nativeRows(admin, userId, sessionId);
    expect(before.session.completed_at).toBeNull();
    expect(before.session.deleted_at).toBeNull();
    expect(before.logs).toHaveLength(0);
    expect(await regionRows(admin, userId)).toEqual([]);

    await completeRetainedSwim(actor, started, { lengths: 16, strokes: ["breaststroke"] });
    await recomputeRegionState(actor, userId, timezone);
    await page.goto(`/app/swim/${workout.id}`);
    const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
    await expect(result).toContainText("16 lengths · 15:00 · RPE 6");
    const completed = await nativeRows(admin, userId, sessionId);
    expect(completed.logs).toHaveLength(1);
    const originalLog = completed.logs[0];
    expect(originalLog.id).toEqual(expect.any(String));
    expect(originalLog.session_id).toBe(sessionId);
    expect(originalLog.modality).toBe("swimming");
    expect(originalLog.client_log_id).toEqual(expect.any(String));
    expect(completed.session.completion_outbox_entry_id).toBe(originalLog.client_log_id);
    expect(completed.session.completed_at).toEqual(expect.any(String));
    expect(completed.session.performed_at).toBe(before.session.performed_at);
    expect(completed.session.deleted_at).toBeNull();
    expect(completed.session.duration_min).toBe(15);
    expect(Number(completed.session.session_rpe)).toBe(6);
    expect(originalLog.duration_sec).toBe(900);
    expect(Number(originalLog.rpe)).toBe(6);
    // The generic projection is numeric(7,3); native lengths/course stay exact.
    expect(Number(originalLog.distance_km)).toBe(0.366);
    expect(originalLog.swim_result).toMatchObject({
      version: 1, lengths: 16, timeMs: 900000, rpe: 6,
      snapshot: { course: workout.definition.issued.snapshot.course, strokes: ["breaststroke"], equipment: [] },
    });
    const completedWorkout = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)!;
    expect(completedWorkout).toMatchObject({
      status: "completed", session_id: sessionId, revision: started.revision + 1,
      scheduled_date: workout.scheduled_date, definition: started.definition,
    });
    const completedRegions = await regionRows(admin, userId);
    assertLedger(completedRegions, userId, timezone, completed.session, originalLog);
    expect(Number(completedRegions.find((row) => row.region === "adductor_groin")!.atl)).toBeGreaterThan(0);

    await editSwimResult(actor, {
      workoutId: workout.id, expectedRevision: completedWorkout.revision,
      result: {
        ...originalLog.swim_result, lengths: 12, timeMs: 600000, rpe: 8,
        snapshot: { ...originalLog.swim_result.snapshot, strokes: ["freestyle"], equipment: ["pull_buoy"] },
      },
    });
    await recomputeRegionState(actor, userId, timezone);
    await page.reload();
    await expect(result).toContainText("12 lengths · 10:00 · RPE 8");
    const edited = await nativeRows(admin, userId, sessionId);
    expect(edited.logs).toHaveLength(1);
    const editedLog = edited.logs[0];
    expect(editedLog).toMatchObject({
      id: originalLog.id, session_id: sessionId, client_log_id: originalLog.client_log_id,
      modality: "swimming", duration_sec: 600,
    });
    expect(Number(editedLog.rpe)).toBe(8);
    expect(Number(editedLog.distance_km)).toBe(0.274);
    expect(editedLog.swim_result).toMatchObject({
      version: 1, lengths: 12, timeMs: 600000, rpe: 8,
      snapshot: { course: originalLog.swim_result.snapshot.course, strokes: ["freestyle"], equipment: ["pull_buoy"] },
      provenance: originalLog.swim_result.provenance,
    });
    expect(edited.session).toEqual({
      ...completed.session, duration_min: 10, session_rpe: edited.session.session_rpe,
    });
    expect(Number(edited.session.session_rpe)).toBe(8);
    const editedWorkout = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)!;
    expect(editedWorkout).toMatchObject({
      status: "completed", session_id: sessionId, revision: completedWorkout.revision + 1,
      scheduled_date: workout.scheduled_date,
    });
    expect(editedWorkout.definition.issued).toEqual(workout.definition.issued);
    expect(editedWorkout.definition.resultHistory).toHaveLength(1);
    expect(editedWorkout.definition.resultHistory![0]).toMatchObject({
      result: originalLog.swim_result, revision: completedWorkout.revision,
    });
    const editedRegions = await regionRows(admin, userId);
    assertLedger(editedRegions, userId, timezone, edited.session, editedLog, completedRegions);
    expect(Number(editedRegions.find((row) => row.region === "adductor_groin")!.atl)).toBe(0);

    await page.getByRole("button", { name: "Delete swim", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim$/);
    const trashed = await nativeRows(admin, userId, sessionId);
    expect(trashed.session).toEqual({ ...edited.session, deleted_at: expect.any(String) });
    expect(Number.isFinite(Date.parse(trashed.session.deleted_at!))).toBe(true);
    expect(trashed.logs).toEqual(edited.logs);
    expect((await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)).toEqual(editedWorkout);
    // No other completed sessions exist for this fresh user: deletion removes
    // the seven rows altogether, rather than storing seven zero-valued rows.
    expect(await regionRows(admin, userId)).toEqual([]);

    await page.goto(`/app/swim/${workout.id}`);
    await page.getByRole("link", { name: "Restore from Trash", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings\/trash$/);
    const trashItem = page.getByTestId("trash-item").and(page.locator(`[data-id="${sessionId}"]`));
    await expect(trashItem).toHaveAttribute("data-kind", "session");
    await trashItem.getByRole("button", { name: "Recover", exact: true }).click();
    await expect(trashItem).toHaveCount(0);
    const restored = await nativeRows(admin, userId, sessionId);
    expect(restored).toEqual(edited);
    expect((await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)).toEqual(editedWorkout);
    const restoredRegions = await regionRows(admin, userId);
    assertLedger(restoredRegions, userId, timezone, restored.session, restored.logs[0], editedRegions);
    await page.goto(`/app/sessions/${sessionId}`);
    await expect(page).toHaveURL(new RegExp(`/app/swim/${workout.id}$`));
    await expect(result).toContainText("12 lengths · 10:00 · RPE 8");
    expect(await nativeRows(admin, userId, sessionId)).toEqual(edited);
    expect(await regionRows(admin, userId)).toEqual(restoredRegions);
  });

  test("A3, DC-SW7: replacing an archived plan preserves retained native history and primary training", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryBaseline(admin, freshUser, seedConfig);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    const issued = await lifecycleState(admin, userId);
    expect(issued.plans.length === 1 && issued.workouts.length === 4).toBe(true);
    const completedLengths = issued.workouts[0].definition.issued.totalLengths;
    const actor = await retainedSwimActor(seedConfig, freshUser);
    await completeRetainedSwim(actor, issued.workouts[0], { lengths: completedLengths });
    await startSwimWorkout(actor, issued.workouts[1].id, issued.workouts[1].revision);
    await recomputeRegionState(actor, userId, timezone);
    const before = await lifecycleState(admin, userId);
    expect(before.workouts.filter((row) => row.status === "completed").length).toBe(1);
    expect(before.workouts.filter((row) => row.status === "started").length).toBe(1);
    expect(before.logs.length).toBe(1);
    expect(before.sessions.length).toBe(3);
    const completed = before.workouts.find((row) => row.status === "completed")!;
    const inProgress = before.workouts.find((row) => row.status === "started")!;
    expect(inProgress.session_id !== completed.session_id && before.sessions.some((row) =>
      row.id === inProgress.session_id && row.completed_at === null && row.completion_outbox_entry_id === null)).toBe(true);
    const receipt = before.logs[0].client_log_id;
    expect(isUuid(receipt) && before.sessions.some((row) =>
      row.id === completed.session_id && row.completion_outbox_entry_id === receipt && !!row.completed_at)).toBe(true);
    expect(isDeepStrictEqual(before.workouts.map((row) => row.definition), issued.workouts.map((row) => row.definition))).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
    lifecycleLedger(before, timezone);

    await page.goto(original.url);
    await openSwimProgramActions(page);

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("link", { name: "Set up swimming", exact: true })).toBeVisible();
    const archived = await lifecycleState(admin, userId);
    expect(archived.plans.length === 1 && archived.plans[0].status === "archived").toBe(true);
    expect(archived.plans[0].revision).toBe(before.plans[0].revision + 1);
    const archiveEvent = archived.plans[0].state.lifecycle?.at(-1);
    expect(archiveEvent?.from === "active" && archiveEvent.to === "archived" &&
      Number.isFinite(Date.parse(archiveEvent.recordedAt))).toBe(true);
    expect(isDeepStrictEqual(archived.plans[0], {
      ...before.plans[0], status: "archived", revision: before.plans[0].revision + 1,
      updated_at: archived.plans[0].updated_at,
      state: { ...before.plans[0].state, lifecycle: [...(before.plans[0].state.lifecycle ?? []), archiveEvent] },
    })).toBe(true);
    expect(isDeepStrictEqual(archived.workouts, before.workouts)).toBe(true);
    const replacementStart = addDaysToYmd(archived.plans[0].ends_on, 1);
    const schedule = await loadTrainingSchedule(actor);
    expect(schedule.entries.length).toBeGreaterThan(0);
    expect(schedule.entries.every((entry) => entry.date < replacementStart)).toBe(true);
    await page.getByRole("link", { name: "Set up swimming", exact: true }).click();
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
    await page.getByLabel("Recent comfortable non-stop lengths", { exact: true }).fill("4");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    await page.getByLabel("Start date", { exact: true }).fill(replacementStart);
    const swimDays = page.getByRole("group", { name: "Swim days", exact: true }).getByRole("checkbox");
    for (const day of await swimDays.all()) {
      await day.setChecked(["1", "4"].includes((await day.getAttribute("value"))!));
    }
    await expect(swimDays.and(page.locator(":checked"))).toHaveCount(2);
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Create swim plan", exact: true })).toBeVisible();
    const overlap = page.getByRole("checkbox", { name: "Keep both workouts on these dates", exact: true });
    await expect(overlap).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create swim plan", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Swims", exact: true })).toBeVisible();
    const replacementId = new URL(page.url()).searchParams.get("plan");
    expect(typeof replacementId === "string" && replacementId !== original.planId).toBe(true);
    const replaced = await lifecycleState(admin, userId);
    expect(replaced.plans.length).toBe(2);
    expect(replaced.plans.filter((row) => row.status === "active").length).toBe(1);
    expect(isDeepStrictEqual(replaced.plans.find((row) => row.id === original.planId), archived.plans[0])).toBe(true);
    const replacement = replaced.plans.find((row) => row.id === replacementId)!;
    expect(replacement.status).toBe("active");
    expect(isDeepStrictEqual(replacement.definition.setup.course, { numerator: 50, denominator: 1, unit: "m" })).toBe(true);
    const newWorkouts = replaced.workouts.filter((row) => row.plan_id === replacementId);
    expect(newWorkouts.length).toBe(4);
    expect(replacement.started_on).toBe(replacementStart);
    expect(newWorkouts.every((row) => row.scheduled_date >= replacementStart)).toBe(true);
    expect(newWorkouts.every((row) => row.status === "scheduled" && row.session_id === null &&
      !before.workouts.some((old) => old.id === row.id))).toBe(true);
    expect(isDeepStrictEqual(replaced.workouts.filter((row) => row.plan_id === original.planId), before.workouts)).toBe(true);
    expect(isDeepStrictEqual(replaced.history.filter((row) => row.workout.plan_id === original.planId), before.history)).toBe(true);
    expect(replaced.history.filter((row) => row.result !== null).length).toBe(1);
    const retained = settledSwimResult(replaced.history.find((row) => row.workout.id === completed.id)!, archived.plans[0]);
    expect(retained.lifecycle.archivedLate).toBe(false);
    expect(countsTowardHistory(retained)).toBe(true);
    expect(isDeepStrictEqual(
      [replaced.sessions, replaced.logs, replaced.sets, replaced.regions, replaced.blocks, replaced.planned],
      [before.sessions, before.logs, before.sets, before.regions, before.blocks, before.planned],
    )).toBe(true);

    for (const status of ["Archived", "Active"] as const) {
      const destination = new URL(`/app/swim?plan=${status === "Archived" ? original.planId : replacementId}`, page.url()).href;
      await openSwimProgramHistory(page);
      const choice = page.getByRole("navigation", { name: "Program history", exact: true })
        .getByRole("link", { name: new RegExp(`${status}$`) });
      await expect(choice).toHaveAttribute("href", new URL(destination).pathname + new URL(destination).search);
      await choice.click();
      await expect(page).toHaveURL(destination);
      await expect(page.getByRole("navigation", { name: "Program history", exact: true, includeHidden: true })
        .getByRole("link", { name: new RegExp(`${status}$`), includeHidden: true })).toHaveAttribute("aria-current", "page");
      await openSwimProgramHistory(page);
      await expect(choice).toHaveAttribute("aria-current", "page");
      await page.reload();
      await expect(page).toHaveURL(destination);
      await openSwimProgramHistory(page);
      const choices = page.getByRole("navigation", { name: "Program history", exact: true });
      await expect(choices.locator('a[href^="/app/swim?plan="]')).toHaveCount(2);
      await expect(choices.getByRole("link", { name: new RegExp(`${status}$`) })).toHaveAttribute("aria-current", "page");
      expect(new URL(page.url()).searchParams.get("plan") === (status === "Archived" ? original.planId : replacementId)).toBe(true);
      await expect(page.getByRole("link", { name: "Set up swimming", exact: true })).toHaveCount(0);
      if (status === "Archived") {
        await expect(page.getByRole("link").filter({ hasText: "Completed" })).toHaveCount(1);
        await expect(page.getByRole("link").filter({ hasText: "In progress" })).toHaveCount(1);
        await page.getByRole("link").filter({ hasText: "Completed" }).click();
        await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
        await page.goto(original.url);
        await page.getByRole("link").filter({ hasText: "In progress" }).click();
        await expect(page.getByRole("heading", { name: "Workout", exact: true })).toBeVisible();
        await expect(page.locator("main > section").first().getByText("In progress", { exact: true })).toBeVisible();
        await page.goto(original.url);
      } else {
        await expect(page.getByRole("link").filter({ hasText: "Scheduled" })).toHaveCount(4);
        await expect(page.getByRole("link").filter({ hasText: "Completed" })).toHaveCount(0);
      }
    }
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), replaced)).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
  });

  test("A4, DC-SW7/DC-SW8/DC-SW9: archived late results remain visible across contexts without duplicate history or load", async ({
    page, context, browser, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryBaseline(admin, freshUser, seedConfig);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    const actor = await retainedSwimActor(seedConfig, freshUser);
    const issued = await savedPlan(admin, userId, original.planId);
    await startSwimWorkout(actor, issued.workouts[0].id, issued.workouts[0].revision);
    const before = await lifecycleState(admin, userId);
    const started = before.workouts.find((row) => row.status === "started");
    expect(!!started?.session_id && before.workouts.filter((row) => row.status === "started").length === 1).toBe(true);
    if (!started?.session_id) throw new Error("Missing started synthetic swim.");
    expect(before.logs.length).toBe(0);
    expect(before.sessions.length).toBe(2);
    const native = before.sessions.find((row) => row.id === started.session_id)!;
    expect(native.completed_at === null && native.completion_outbox_entry_id === null).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
    const completedLengths = started.definition.issued.totalLengths;
    const online = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, hasTouch: true });
    let bodyFailed = false;
    try {
      await signInAs(online, freshUser, seedConfig, baseURL!);
      const archivePage = await online.newPage();
      await archivePage.goto(original.url);
      await openSwimProgramActions(archivePage);

      await archivePage.getByRole("button", { name: "Archive", exact: true }).click();
      await expect(archivePage.getByRole("link", { name: "Set up swimming", exact: true })).toBeVisible();
      const archived = await lifecycleState(admin, userId);
      expect(archived.plans.length === 1 && archived.plans[0].status === "archived").toBe(true);
      const transition = archived.plans[0].state.lifecycle?.at(-1);
      expect(transition?.from === "active" && transition.to === "archived" &&
        Number.isFinite(Date.parse(transition.recordedAt))).toBe(true);
      expect(isDeepStrictEqual(archived.plans[0], {
        ...before.plans[0], status: "archived", revision: before.plans[0].revision + 1,
        updated_at: archived.plans[0].updated_at,
        state: { ...before.plans[0].state, lifecycle: [...(before.plans[0].state.lifecycle ?? []), transition] },
      })).toBe(true);
      expect(isDeepStrictEqual(
        [archived.workouts, archived.sessions, archived.logs, archived.regions],
        [before.workouts, before.sessions, before.logs, before.regions],
      )).toBe(true);
      // Arrange a retained completion recorded after archival; no browser queue is involved.
      await completeRetainedSwim(actor, started, { lengths: completedLengths, strokes: ["breaststroke"] });
      await recomputeRegionState(actor, userId, timezone);
      const retained = await nativeRows(admin, userId, started.session_id);
      const entry = { id: retained.logs[0].client_log_id, sessionId: started.session_id };
      await page.goto(`/app/swim/${started.id}`);
      await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      const completed = await lifecycleState(admin, userId);
      expect(completed.logs.length).toBe(1);
      expect(completed.sessions.length).toBe(2);
      expect(completed.workouts.filter((row) => row.status === "completed").length).toBe(1);
      const session = completed.sessions.find((row) => row.id === started.session_id)!;
      const log = completed.logs[0];
      expect(isDeepStrictEqual(
        [session.completion_outbox_entry_id, log.client_log_id, log.session_id],
        [entry.id, entry.id, entry.sessionId],
      )).toBe(true);
      expect(!!session.completed_at && Date.parse(session.completed_at) >= Date.parse(transition!.recordedAt)).toBe(true);
      expect(session.deleted_at === null && session.performed_at === native.performed_at).toBe(true);
      expect(isDeepStrictEqual(
        [log.modality, log.duration_sec, Number(log.rpe), session.duration_min, Number(session.session_rpe)],
        ["swimming", 900, 6, 15, 6],
      )).toBe(true);
      expect(log.swim_result.completion === "completed").toBe(true);
      expect(isDeepStrictEqual(
        [log.swim_result.lengths, log.swim_result.timeMs, log.swim_result.rpe, log.swim_result.snapshot.strokes],
        [completedLengths, 900000, 6, ["breaststroke"]],
      )).toBe(true);
      expect(isDeepStrictEqual(log.swim_result.snapshot.course, started.definition.issued.snapshot.course)).toBe(true);
      expect(completed.plans.length).toBe(1);
      expect(isDeepStrictEqual(completed.plans[0], {
        ...archived.plans[0], revision: archived.plans[0].revision + 1, updated_at: completed.plans[0].updated_at,
      })).toBe(true);
      expect(isDeepStrictEqual(
        completed.workouts.filter((row) => row.id !== started.id),
        before.workouts.filter((row) => row.id !== started.id),
      )).toBe(true);
      expect(isDeepStrictEqual(completed.workouts.find((row) => row.id === started.id)?.definition, started.definition)).toBe(true);
      const history = completed.history.filter((row) => row.result !== null);
      expect(history.length).toBe(1);
      const settled = settledSwimResult(history[0], completed.plans[0]);
      expect(settled.lifecycle.archivedLate).toBe(true);
      expect(countsTowardHistory(settled)).toBe(true);
      expect(countsTowardAdherence(settled)).toBe(true);
      expect(countsTowardProgression(settled)).toBe(false);
      expect(settled.actualMs).toBe(900000);
      expect(deriveSwimWeekCandidate(completed.plans[0], completed.history, todayYmd(timezone)) === null).toBe(true);
      lifecycleLedger(completed, timezone);
      expect(Number(completed.regions.find((row) => row.region === "adductor_groin")?.atl) > 0).toBe(true);

      await page.reload();
      await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      await archivePage.goto(`/app/swim/${started.id}`);
      await expect(archivePage.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      const replayed = await lifecycleState(admin, userId);
      expect(isDeepStrictEqual(
        [replayed.plans, replayed.workouts, replayed.sessions, replayed.logs, replayed.history, replayed.sets],
        [completed.plans, completed.workouts, completed.sessions, completed.logs, completed.history, completed.sets],
      )).toBe(true);
      expect(isDeepStrictEqual(
        replayed.regions.map((row) => ({ ...row, updated_at: null })),
        completed.regions.map((row) => ({ ...row, updated_at: null })),
      )).toBe(true);
      lifecycleLedger(replayed, timezone);
      expect(isDeepStrictEqual([replayed.blocks, replayed.planned, replayed.sets], [before.blocks, before.planned, before.sets])).toBe(true);
      expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
      await page.goto(original.url);
      await page.reload();
      await expect(page.getByRole("link", { name: "Set up swimming", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Programs", exact: true })).toHaveCount(1);
    } catch (error) {
      bodyFailed = true;
      throw error;
    } finally {
      const closed = await online.close().then(() => true, () => false);
      if (!bodyFailed) expect(closed).toBe(true);
    }
  });

  async function primaryRecoveryBaseline(admin: SupabaseClient, user: Parameters<typeof primaryBaseline>[1], config: SeedConfig) {
    const userId = user.userId;
    const primary = await primaryBaseline(admin, user, config);
    const planned = primary.initial[1]!;
    const recovery = planned.find((row) => row.completed_session_id === null)!;
    const prescription: Prescription = {
      items: (recovery.prescription as Prescription).items.map((item) => ({ ...item, sets: 1 })),
    };
    expect(prescription.items.length === 1 && planned.some((row) => row.completed_session_id !== null)).toBe(true);
    const saved = await admin.from("planned_sessions").update({
      week_index: 1, role: "deload", prescription,
    }).eq("user_id", userId).eq("block_id", recovery.block_id).eq("id", recovery.id)
      .select("id,role,prescription").single();
    const editRevision = saved.data?.prescription?.meta?.editRevision;
    expect(saved.error === null && saved.data?.id === recovery.id && saved.data.role === "deload" &&
      isUuid(editRevision) &&
      isDeepStrictEqual(saved.data.prescription, { ...prescription, meta: { editRevision } })).toBe(true);
    return { snapshot: primary.snapshot, initial: await primary.snapshot() };
  }

  function lifecycleActual(state: Awaited<ReturnType<typeof lifecycleState>>, workoutId: string) {
    expect(state.plans.length === 1 && state.workouts.length === 4 &&
      state.sessions.length === 2 && state.logs.length === 1 && state.sets.length === 1).toBe(true);
    const workout = state.workouts.find((row) => row.id === workoutId)!;
    const session = state.sessions.find((row) => row.id === workout.session_id)!;
    const log = state.logs[0];
    expect(workout.status === "completed" && isUuid(session?.id) && session.user_id === workout.user_id &&
      state.workouts.filter((row) => row.session_id !== null).length === 1).toBe(true);
    expect(isUuid(log.id) && isUuid(log.client_log_id) && log.session_id === session.id &&
      session.completion_outbox_entry_id === log.client_log_id && session.deleted_at === null &&
      Number.isFinite(Date.parse(session.completed_at))).toBe(true);
    expect(state.history.filter((row) => row.result !== null).length).toBe(1);
    return { workout, session, log };
  }

  test("A5, DC-SW7/DC-SW9: permanent deletion removes a retained edited result while preserving its planned target", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryRecoveryBaseline(admin, freshUser, seedConfig);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    const issued = await lifecycleState(admin, userId);
    const target = issued.workouts[0];
    const lengths = target.definition.issued.totalLengths;
    expect(lengths > 0 && target.status === "scheduled" && target.session_id === null).toBe(true);
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").locator(`a[href="/app/swim/${target.id}"]`).click();
    const prescription = page.getByRole("heading", { name: "Workout", exact: true }).locator("..");
    const targetText = await prescription.innerText();
    const actor = await retainedSwimActor(seedConfig, freshUser);
    const started = await startSwimWorkout(actor, target.id, target.revision);
    expect(started.status === "started" && typeof started.session_id === "string" &&
      isUuid(started.session_id) && started.revision === target.revision + 1).toBe(true);
    await completeRetainedSwim(actor, started, { lengths, strokes: ["breaststroke"] });
    await recomputeRegionState(actor, userId, timezone);
    await page.reload();
    const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
    await expect(result).toContainText(`${lengths} lengths · 15:00 · RPE 6`);
    const completed = await lifecycleState(admin, userId);
    const first = lifecycleActual(completed, target.id);
    expect(first.workout.revision === started.revision + 1 &&
      isDeepStrictEqual(first.workout.definition, target.definition)).toBe(true);
    expect(isDeepStrictEqual(
      [first.log.swim_result.lengths, first.log.swim_result.timeMs, first.log.swim_result.rpe,
        first.log.swim_result.snapshot.course, first.log.swim_result.snapshot.strokes],
      [lengths, 900000, 6, target.definition.issued.snapshot.course, ["breaststroke"]],
    )).toBe(true);
    lifecycleLedger(completed, timezone);

    // Create a real prior result revision so purge-history removal is non-vacuous.
    await editSwimResult(actor, {
      workoutId: target.id, expectedRevision: first.workout.revision,
      result: { ...first.log.swim_result, timeMs: 720000 },
    });
    await recomputeRegionState(actor, userId, timezone);
    await page.reload();
    await expect(result).toContainText(`${lengths} lengths · 12:00 · RPE 6`);
    const saved = await lifecycleState(admin, userId);
    const actual = lifecycleActual(saved, target.id);
    const native = await nativeRows(admin, userId, actual.session.id);
    expect(native.logs.length === 1 && isDeepStrictEqual(native.logs[0].swim_result, actual.log.swim_result)).toBe(true);
    expect(actual.workout.revision === first.workout.revision + 1 &&
      actual.workout.definition.resultHistory?.length === 1 &&
      isDeepStrictEqual(actual.workout.definition.resultHistory[0].result, first.log.swim_result)).toBe(true);
    expect(actual.log.id === first.log.id && actual.log.client_log_id === first.log.client_log_id &&
      actual.session.completion_outbox_entry_id === first.session.completion_outbox_entry_id &&
      actual.session.completed_at === first.session.completed_at && actual.log.swim_result.timeMs === 720000).toBe(true);
    lifecycleLedger(saved, timezone);
    expect(Number(saved.regions.find((row) => row.region === "adductor_groin")?.atl) > 0).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);

    await page.getByRole("button", { name: "Delete swim", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim$/);
    const trashed = await lifecycleState(admin, userId);
    const deletedSession = trashed.sessions.find((row) => row.id === actual.session.id)!;
    expect(Number.isFinite(Date.parse(deletedSession.deleted_at)) &&
      isDeepStrictEqual(deletedSession, {
        ...actual.session, deleted_at: deletedSession.deleted_at, updated_at: deletedSession.updated_at,
      })).toBe(true);
    expect(isDeepStrictEqual([trashed.logs, trashed.workouts], [saved.logs, saved.workouts])).toBe(true);
    lifecycleLedger(trashed, timezone);
    expect(Number(trashed.regions.find((row) => row.region === "adductor_groin")?.atl)).toBe(0);
    expect(trashed.regions.some((row) => Number(row.atl) > 0)).toBe(true);
    await page.goto(`/app/swim/${target.id}`);
    await page.getByRole("link", { name: "Restore from Trash", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings\/trash$/);
    const item = page.getByTestId("trash-item").and(page.locator(`[data-id="${actual.session.id}"]`));
    await expect(page.getByTestId("trash-item")).toHaveCount(1);
    await expect(item).toHaveAttribute("data-kind", "session");
    await item.getByTestId("permanent-delete-trigger").click();
    const modal = item.getByTestId("confirm-delete-modal");
    await expect(page.getByTestId("confirm-delete-modal")).toHaveCount(1);
    await expect(modal).toBeVisible();
    const confirm = modal.getByTestId("confirm-delete-confirm");
    const input = modal.getByTestId("confirm-delete-input");
    await expect(input).toHaveValue("");
    await expect(confirm).toBeDisabled();
    const token = (await modal.locator("code").innerText()).trim();
    expect(/^\d{4}-\d{2}-\d{2}$/.test(token) && token === actual.session.performed_at.slice(0, 10)).toBe(true);
    await input.fill("not-the-session-date");
    await expect(confirm).toBeDisabled();
    await input.fill(token);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId("confirm-delete-modal")).toHaveCount(0);
    const purged = await lifecycleState(admin, userId);
    const absent = await Promise.all([
      admin.from("sessions").select("id").eq("user_id", userId).eq("id", actual.session.id),
      admin.from("cardio_logs").select("id").eq("session_id", actual.session.id),
    ]);
    expect(absent.every((row) => row.error === null && row.data?.length === 0)).toBe(true);
    const retained = purged.workouts.find((row) => row.id === target.id)!;
    const { resultHistory: removedHistory, ...definition } = actual.workout.definition;
    expect(removedHistory?.length).toBe(1);
    expect(isDeepStrictEqual(retained, {
      ...actual.workout, session_id: null, revision: actual.workout.revision + 1,
      updated_at: retained.updated_at, definition,
    })).toBe(true);
    expect(retained.user_id === userId && retained.status === "completed" &&
      retained.definition.resultHistory === undefined &&
      isDeepStrictEqual([retained.definition.original, retained.definition.issued],
        [target.definition.original, target.definition.issued])).toBe(true);
    expect(isDeepStrictEqual(purged.sessions, issued.sessions) && purged.logs.length === 0).toBe(true);
    expect(isDeepStrictEqual(purged.regions, trashed.regions)).toBe(true);
    lifecycleLedger(purged, timezone);
    const history = purged.history.find((row) => row.workout.id === target.id)!;
    expect(history.sourceGone && !history.deleted && history.result === null &&
      history.completedAt === null && history.performedAt === null && history.notes === null).toBe(true);
    const settled = settledSwimResult(history, purged.plans[0]);
    expect(!countsTowardHistory(settled) && !countsTowardAdherence(settled) && !countsTowardProgression(settled)).toBe(true);
    const week = summarizeSwimWeek({ weekStartISO: mondayOfYmd(target.scheduled_date), results: [settled] });
    expect(week.sessionsPlanned === 0 && week.adherence === null).toBe(true);
    const hub = await loadSwimHubView(actor, userId, purged.plans[0]);
    expect(hub.analytics.bests.length === 0 && hub.analytics.weeks.every((row) => row.frequency === 0 && row.actual === "—")).toBe(true);
    expect(isDeepStrictEqual(
      purged.workouts.filter((row) => row.id !== target.id), issued.workouts.filter((row) => row.id !== target.id),
    )).toBe(true);
    expect(isDeepStrictEqual([purged.blocks, purged.planned, purged.sets], [issued.blocks, issued.planned, issued.sets])).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
    await page.goto(original.url);
    const card = page.locator(`a[href="/app/swim/${target.id}"]`);
    await expect(card).toContainText("Unavailable");
    await expect(page.getByRole("heading", { name: "Best swims", exact: true })).toHaveCount(0);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/app/swim/${target.id}$`));
    await expect(page.getByRole("status").filter({ hasText: "Result removed" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Result removed" })).toBeVisible();
    expect((await prescription.innerText()) === targetText).toBe(true);
    await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Start swim|Finish swim|Edit result|Save changes)$/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^(Log swim|Restore from Trash)$/ })).toHaveCount(0);
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), purged)).toBe(true);
  });

  test("A7, DC-SW7/DC-SW9: a new limitation preserves retained results and blocks setup and resume", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryBaseline(admin, freshUser, seedConfig);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    const issued = await lifecycleState(admin, userId);
    const [target, future] = issued.workouts;
    const exposure = swimWorkoutExposure(target.definition.issued);
    const futureExposure = swimWorkoutExposure(future.definition.issued);
    const muscle = ALL_MUSCLE_GROUPS.find((value) =>
      exposure.primaryRegions.includes(MUSCLE_TO_REGION[value]) &&
      futureExposure.regions.includes(MUSCLE_TO_REGION[value]));
    if (!muscle) throw new Error("Missing applicable issued swimming exposure.");
    const region = MUSCLE_TO_REGION[muscle];
    expect(REGIONS.includes(region) && target.id !== future.id &&
      [target, future].every((row) => row.status === "scheduled" && row.session_id === null)).toBe(true);
    const lengths = target.definition.issued.totalLengths;
    expect(lengths > 0).toBe(true);
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").locator(`a[href="/app/swim/${target.id}"]`).click();
    const prescription = page.getByRole("heading", { name: "Workout", exact: true }).locator("..");
    const targetText = await prescription.innerText();
    const actor = await retainedSwimActor(seedConfig, freshUser);
    const startedWorkout = await startSwimWorkout(actor, target.id, target.revision);
    const notes = "Synthetic retained swim result";
    await completeRetainedSwim(actor, startedWorkout, { lengths, notes });
    await recomputeRegionState(actor, userId, timezone);
    const started = await lifecycleState(admin, userId);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);

    async function limitations() {
      const rows = await admin.from("limitations").select("*").eq("user_id", userId).order("id");
      if (rows.error || !rows.data) throw new Error("Could not read synthetic limitations.");
      return rows.data;
    }
    expect((await limitations()).length === 0).toBe(true);
    await page.goto("/app/recovery/injuries");
    await page.getByTestId("add-limitation-button").first().click();
    await expect(page.getByTestId("add-limitation-modal")).toBeVisible();
    await page.getByTestId("lim-kind").fill("Synthetic swim restriction");
    await page.getByTestId("lim-severity-mild").click();
    await page.getByTestId(`muscle-pick-chip-${muscle}`).click();
    await page.getByTestId("lim-region").selectOption(region);
    await page.getByTestId("lim-save").click();
    await expect(page.getByTestId("add-limitation-modal")).toBeHidden();
    const active = page.getByTestId("active-limitation-card");
    await expect(active).toHaveCount(1);
    await expect(active).toContainText("Synthetic swim restriction");
    const restriction = await limitations();
    expect(restriction.length === 1 && isUuid(restriction[0].id) &&
      restriction[0].user_id === userId && restriction[0].resolved_at === null &&
      restriction[0].kind === "Synthetic swim restriction" && restriction[0].severity === "mild" &&
      restriction[0].region === region && isDeepStrictEqual(restriction[0].affected_muscles, [muscle])).toBe(true);
    // Adding a limitation may legitimately change primary training; protect its new baseline.
    const postLimitationPrimary = await primary.snapshot();
    const restricted = await lifecycleState(admin, userId);
    expect(isDeepStrictEqual(
      [restricted.plans, restricted.workouts, restricted.sessions, restricted.logs],
      [started.plans, started.workouts, started.sessions, started.logs],
    )).toBe(true);

    await page.goto(`/app/swim/${target.id}`);
    const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
    await expect(result).toContainText(`${lengths} lengths · 15:00 · RPE 6`);
    await expect(result).toContainText(notes);
    expect(await prescription.innerText()).toBe(targetText);
    const completed = await lifecycleState(admin, userId);
    const actual = lifecycleActual(completed, target.id);
    expect(actual.session.id === startedWorkout.session_id &&
      actual.workout.revision === startedWorkout.revision + 1 &&
      isDeepStrictEqual(actual.workout.definition, target.definition) &&
      isDeepStrictEqual(
        [actual.log.swim_result.lengths, actual.log.swim_result.timeMs, actual.log.swim_result.rpe,
          actual.log.swim_result.snapshot, actual.session.notes],
        [lengths, 900000, 6, target.definition.issued.snapshot, notes],
      )).toBe(true);
    const history = completed.history.find((row) => row.workout.id === target.id)!;
    expect(isDeepStrictEqual(history.result, actual.log.swim_result) &&
      history.completedAt === actual.session.completed_at && !history.deleted && !history.sourceGone &&
      countsTowardHistory(settledSwimResult(history, completed.plans[0]))).toBe(true);
    lifecycleLedger(completed, timezone);
    expect(Number(completed.regions.find((row) => row.region === region)?.atl) > 0 &&
      isDeepStrictEqual(await primary.snapshot(), postLimitationPrimary) &&
      isDeepStrictEqual(await limitations(), restriction)).toBe(true);
    expect(isDeepStrictEqual(
      completed.workouts.filter((row) => row.id !== target.id),
      issued.workouts.filter((row) => row.id !== target.id),
    )).toBe(true);

    await page.goto("/app/swim/setup");
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
    await page.getByLabel("Recent comfortable non-stop lengths", { exact: true }).fill("4");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    const beforeSetup = await lifecycleState(admin, userId);
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toContainText("Review your active limitations before swimming");
    await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toContainText(REGION_LABELS[region]);
    await expect(page.getByLabel("Recent comfortable non-stop lengths", { exact: true })).toHaveValue("4");
    await expect(page.getByRole("button", { name: "Create swim plan", exact: true })).toHaveCount(0);
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), beforeSetup) &&
      isDeepStrictEqual(beforeSetup, completed) &&
      isDeepStrictEqual(await limitations(), restriction) &&
      isDeepStrictEqual(await primary.snapshot(), postLimitationPrimary)).toBe(true);

    await page.goto(original.url);
    await openSwimProgramActions(page);

    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByTestId("page-header").getByText("Paused program · Swimming", { exact: true })).toBeVisible();
    const paused = await lifecycleState(admin, userId);
    expect(paused.plans[0].status === "paused" && paused.plans[0].revision === completed.plans[0].revision + 1 &&
      isDeepStrictEqual(paused.workouts, completed.workouts)).toBe(true);
    const remaining = paused.workouts.filter((row) => row.status === "scheduled" && row.session_id === null);
    expect(remaining.length === 3 && isDeepStrictEqual(
      paused.plans[0].state.pauseSnapshot?.workoutIds, remaining.map((row) => row.id),
    )).toBe(true);
    const today = await page.getByLabel("Resume from", { exact: true }).getAttribute("min");
    if (!today) throw new Error("Missing server-local resume minimum.");
    const resumeFrom = addDaysToYmd(paused.plans[0].ends_on > today ? paused.plans[0].ends_on : today, 1);
    await page.getByLabel("Resume from", { exact: true }).fill(resumeFrom);
    await page.getByRole("button", { name: "Preview dates", exact: true }).click();
    const preview = page.getByRole("heading", { name: "New swim dates", exact: true }).locator("..");
    await expect(preview.getByRole("listitem")).toHaveCount(remaining.length);
    const dates = await preview.getByRole("listitem").allTextContents();
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= resumeFrom) &&
      isDeepStrictEqual(await lifecycleState(admin, userId), paused)).toBe(true);
    const beforeResume = await lifecycleState(admin, userId);
    await page.getByRole("button", { name: "Accept dates and resume", exact: true }).click();
    await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toContainText("Review your active limitations before swimming");
    await expect(page.getByRole("alert").and(page.locator(":not(#__next-route-announcer__)"))).toContainText(REGION_LABELS[region]);
    await expect(page.getByLabel("Resume from", { exact: true })).toHaveValue(resumeFrom);
    await expect(page.getByTestId("page-header").getByText("Paused program · Swimming", { exact: true })).toBeVisible();
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), beforeResume) &&
      isDeepStrictEqual(beforeResume, paused) &&
      isDeepStrictEqual(await limitations(), restriction) &&
      isDeepStrictEqual(await primary.snapshot(), postLimitationPrimary)).toBe(true);
    await page.reload();
    await expect(page.getByTestId("page-header").getByText("Paused program · Swimming", { exact: true })).toBeVisible();
    await page.locator(`a[href="/app/swim/${target.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/swim/${target.id}$`));
    await expect(result).toContainText(`${lengths} lengths · 15:00 · RPE 6`);
    await page.reload();
    await expect(result).toContainText(`${lengths} lengths · 15:00 · RPE 6`);
    expect((await prescription.innerText()) === targetText &&
      isDeepStrictEqual(await lifecycleState(admin, userId), paused) &&
      isDeepStrictEqual(await limitations(), restriction) &&
      isDeepStrictEqual(await primary.snapshot(), postLimitationPrimary)).toBe(true);
    lifecycleActual(paused, target.id);
    lifecycleLedger(paused, timezone);
  });
});
