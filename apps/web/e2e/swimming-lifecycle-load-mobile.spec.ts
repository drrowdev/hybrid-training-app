import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { errors, type Page, type Request } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { ALL_REGIONS, finalEwma, type Region, type SwimActualResult } from "@hta/domain";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedRecentBlock, seedPlannedSessionsForBlock } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd, todayYmd, ymdInTimezone } from "../src/lib/dates";
import { structuredSwimRegions } from "../src/lib/swim/load";
import { cardioIntensityScalar, normaliseHrZones } from "../src/lib/engine/cardio-intensity";
import { CARDIO_LOAD_SCALAR, PRIMARY_REGION_WEIGHT, SECONDARY_REGION_WEIGHT } from "../src/lib/engine/set-load";
import type { SwimPlanRow, SwimWorkoutRow } from "../src/lib/swim/storage";
import { countsTowardAdherence, countsTowardHistory, countsTowardProgression } from "@hta/domain";
import { deriveDailyRegionLoad } from "../src/lib/engine/region-daily-load";
import { deriveSwimWeekCandidate, loadSwimHistory, settledSwimResult } from "../src/lib/swim/queries";
import { isUuid, sortBySeq, type OutboxEntry } from "../src/lib/offline/outbox-core";
import {
  SWIM_ALERT_CODEBOOK, alertAnnotation, classifyAlertNodes, classifyWorkoutViewNodes, pauseBackend,
  unavailableAlert, validateAlertCategory, type AlertObservation,
} from "../scripts/swim-alert-membership";

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
  await page.getByLabel("Recent comfortable continuous lengths", { exact: true }).fill("4");
  await page.getByLabel("Weeks", { exact: true }).fill("2");
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

async function primaryBaseline(admin: SupabaseClient, userId: string) {
  const timezone = await userTimezone(admin, userId);
  const blockId = await seedRecentBlock(admin, userId, {
    status: "active", weeks: 2, startedOn: addDaysToYmd(todayYmd(timezone), -7),
  });
  const plannedIds = await seedPlannedSessionsForBlock(admin, userId, blockId, {
    totalSessions: 2, loggedCount: 1,
  });
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
  const updated = await admin.from("planned_sessions").update({ prescription })
    .eq("user_id", userId).eq("block_id", blockId).in("id", plannedIds);
  expect(updated.error).toBeNull();
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

async function lifecycleQueue(page: Page): Promise<OutboxEntry[]> {
  const rows = await page.evaluate(() => new Promise<OutboxEntry[]>((resolve, reject) => {
    const open = indexedDB.open("hta-offline", 1);
    // Read the real queue without creating or repairing it.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => reject(new Error("Native outbox unavailable."));
    open.onsuccess = () => {
      const db = open.result;
      const failed = () => { db.close(); reject(new Error("Native outbox read failed.")); };
      try {
        const tx = db.transaction("outbox", "readonly");
        const request = tx.objectStore("outbox").getAll();
        tx.oncomplete = () => { db.close(); resolve(request.result as OutboxEntry[]); };
        tx.onerror = failed;
        tx.onabort = failed;
      } catch { failed(); }
    };
  }));
  return sortBySeq(rows);
}

test.describe("ADR0079 mobile swimming lifecycle and regional load", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });
  test.skip(!swimE2EEnabled(process.env), "Blocked: swimming E2E was not explicitly requested.");

  test("A1, DC-SW7: pause, preview, resume, finish and archive preserve primary training and issued swims", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }, testInfo) => {
    await markOnboarded(admin, freshUser.userId);
    const primary = await primaryBaseline(admin, freshUser.userId);
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
    await page.getByRole("link").and(page.locator(`[href="/app/swim/${first.id}"]`)).click();
    await page.getByRole("button", { name: "Start swim", exact: true }).click();
    await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
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
      await expect(page.locator("main > section").first().getByText("Paused", { exact: true })).toBeVisible({ timeout: visibilityBudget });
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
    await expect(page.locator("main > section").first().getByText("Active", { exact: true })).toBeVisible();
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
      await page.getByRole("button", { name: "Finish plan", exact: true }).click();
      const deadline = performance.now() + 5000;
      const outcome = await confirmPlanStatus(admin, freshUser.userId, planId, "finished", deadline);
      expect(outcome).not.toBe("read-error");
      expect(outcome).toBe("reached");
      const remaining = deadline - performance.now();
      expect(remaining).toBeGreaterThan(0);
      await expect(page.locator("main > section").first().getByText("Finished", { exact: true })).toBeVisible({ timeout: remaining });
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, "finished");
      expect(saved.workouts).toEqual(resumed.workouts);
      expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);
      expect(await primary.snapshot()).toEqual(primary.initial);
      previous = saved;
    }
    {
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      const deadline = performance.now() + 5000;
      const outcome = await confirmPlanStatus(admin, freshUser.userId, planId, "archived", deadline);
      expect(outcome).not.toBe("read-error");
      expect(outcome).toBe("reached");
      const remaining = deadline - performance.now();
      expect(remaining).toBeGreaterThan(0);
      await expect(page.locator("main > section").first().getByText("Archived", { exact: true })).toBeVisible({ timeout: remaining });
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, "archived");
      expect(saved.workouts).toEqual(resumed.workouts);
      expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);
      expect(await primary.snapshot()).toEqual(primary.initial);
      previous = saved;
    }
    await page.reload();
    await expect(page.locator("main > section").first().getByText("Archived", { exact: true })).toBeVisible();
    expect(await savedPlan(admin, freshUser.userId, planId)).toEqual(previous);
    expect(await primary.snapshot()).toEqual(primary.initial);
  });

  test("A2, DC-SW9: native UI completion, edit, trash and recovery replace regional load exactly once", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }, testInfo) => {
    async function captureFailureView(diagnostic: AlertObservation) {
      diagnostic.category = "unavailable";
      diagnostic.control = "unavailable";
      diagnostic.result = "unavailable";
      const interrupted = () => testInfo.status === "timedOut" || testInfo.status === "interrupted" || page.isClosed();
      const budget = 1000;
      if (interrupted()) return;
      const deadline = performance.now() + budget;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const reads: Promise<unknown>[] = [];
      try {
        // One immediate visible-branch read; none describes only these tracked matches.
        const view = page.getByRole("button", { name: /^(Start swim|Starting…)$/ })
          .or(page.getByRole("link", { name: /^(Log swim|Restore from Trash)$/ }))
          .or(page.getByRole("status").filter({ hasText: /^(Plan paused|Plan finished|Plan archived|Result removed|Swimming is currently unavailable\.)$/ }))
          .or(page.getByRole("heading", { name: /^(Edit your swim|Your swim)$/, level: 2 }))
          .or(page.getByRole("heading", { name: "404", exact: true, level: 1 }))
          .filter({ visible: true }).evaluateAll(classifyWorkoutViewNodes).then(
            (value) => value, () => ({ control: "unavailable", result: "unavailable" } as const),
          );
        reads.push(view);
        const alert = page.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK).then(
          ({ count, category }) => count < 0 || category === "unreadable" ? "unavailable" as const : validateAlertCategory(category),
          () => "unavailable" as const,
        );
        reads.push(alert);
        const sample = Promise.all([view, alert]).then((value) => { settled = true; return value; });
        reads.push(sample);
        const value = await Promise.race([
          sample,
          new Promise<undefined>((resolve) => { expiry = setTimeout(() => resolve(undefined), budget); }),
        ]);
        if (value && !interrupted() && performance.now() < deadline) {
          Object.assign(diagnostic, value[0], { category: value[1] });
        }
      } finally {
        clearTimeout(expiry);
        // A race is not cancellation. Only this already-failed test's page may be closed.
        // Collection is capped; closing/draining remains best-effort, not a forced-close guarantee.
        if (!settled && reads.length > 0) await page.close().catch(() => undefined);
        await Promise.allSettled(reads);
      }
    }
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    expect(await regionRows(admin, userId)).toEqual([]);
    const { planId } = await createPlan(page);
    const scheduled = await savedPlan(admin, userId, planId);
    const workout = scheduled.workouts[0];
    await page.getByRole("link").and(page.locator(`[href="/app/swim/${workout.id}"]`)).click();
    const expected = new URL(`/app/swim/${workout.id}`, baseURL!).href;
    await expect(page).toHaveURL(expected);
    await expect(page.getByRole("button", { name: "Start swim", exact: true })).toBeEnabled();
    const diagnostic = unavailableAlert("a2-post-start");
    const { origin, pathname } = new URL(expected);
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
    const transport = Promise.all([requestWaiter, responseWaiter]).then(([requestOutcome, responseOutcome]) => {
      expect(requestOutcome).toBe("seen");
      expect(responseOutcome.outcome).toBe("seen");
      expect(responseOutcome.paired).toBe(true);
      expect(responseOutcome.status).toBe(200);
    }).then(() => ({ ok: true } as const), (error: unknown) => ({ ok: false, error } as const));
    try {
      await page.getByRole("button", { name: "Start swim", exact: true }).click();
      await expect.poll(async () => {
        const saved = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id);
        return saved?.status === "started" && typeof saved.session_id === "string" && saved.session_id.length > 0;
      }).toBe(true);
      diagnostic.backend = "reached";
      // Start the original separate UI window immediately; HTTP 200 is transport-only.
      const [uiOutcome, transportOutcome] = await Promise.allSettled([(async () => {
        try {
          await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
        } catch (error) {
          await captureFailureView(diagnostic).catch(() => undefined);
          throw error;
        }
      })(), transport]);
      // Retain the original UI error even when transport also failed.
      if (uiOutcome.status === "rejected") throw uiOutcome.reason;
      if (transportOutcome.status === "rejected") throw transportOutcome.reason;
      if (!transportOutcome.value.ok) throw transportOutcome.value.error;
    } finally {
      await Promise.allSettled([requestWaiter, responseWaiter, transport]);
      const annotation = alertAnnotation(diagnostic);
      if (annotation) testInfo.annotations.push(annotation);
    }
    const started = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id)!;
    expect(started.status).toBe("started");
    const sessionId = started.session_id;
    if (!sessionId) throw new Error("Missing started native session ID.");
    const before = await nativeRows(admin, userId, sessionId);
    expect(before.session.completed_at).toBeNull();
    expect(before.session.deleted_at).toBeNull();
    expect(before.logs).toHaveLength(0);
    expect(await regionRows(admin, userId)).toEqual([]);

    await page.getByRole("link", { name: "Log swim", exact: true }).click();
    await page.getByLabel("Whole lengths", { exact: true }).fill("16");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("15:00");
    await page.getByRole("radio", { name: "6 moderate", exact: true }).click();
    await page.getByText("Notes, changes and splits", { exact: true }).click();
    await page.getByRole("combobox", { name: "Stroke", exact: true }).selectOption("breaststroke");
    await page.getByRole("button", { name: "Finish swim", exact: true }).click();
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

    await result.getByRole("button", { name: "Edit result", exact: true }).click();
    await page.getByLabel("Whole lengths", { exact: true }).fill("12");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("10:00");
    await page.getByRole("radio", { name: "8 tough", exact: true }).click();
    await page.getByText("Notes, changes and splits", { exact: true }).click();
    await page.getByRole("combobox", { name: "Stroke", exact: true }).selectOption("freestyle");
    await page.getByRole("checkbox", { name: "Pull buoy", exact: true }).check();
    const editDiagnostic = unavailableAlert("a2-edit");
    const controller = new AbortController();
    const owned: Promise<unknown>[] = [];
    let editExpiry: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(await page.locator("#swim-result").evaluate(
        (form) => form instanceof HTMLFormElement && form.checkValidity(),
      )).toBe(true);
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
      owned.push(requestWaiter, responseWaiter);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      const deadline = performance.now() + 5000;
      const observationBudget = deadline - performance.now();
      expect(observationBudget).toBeGreaterThan(0);
      const expired = new Promise<"expired">((resolve) => {
        editExpiry = setTimeout(() => {
          controller.abort();
          resolve("expired");
        }, observationBudget);
      });
      const active = () => !controller.signal.aborted && performance.now() < deadline;
      // Start both reads before transport assertions; an alert cannot suppress the owned goal sample.
      const polling = (async () => {
        const intervals = [100, 250, 500, 1000];
        let attempt = 0;
        while (active()) {
          const backend = nativeRows(admin, userId, sessionId, controller.signal).then((sample) => {
            if (!active()) return "expired" as const;
            expect(Array.isArray(sample.logs)).toBe(true);
            for (const log of sample.logs) {
              expect(typeof log.id === "string" && typeof log.client_log_id === "string" &&
                log.session_id === sessionId && typeof log.swim_result?.lengths === "number" &&
                typeof log.swim_result?.timeMs === "number" && typeof log.swim_result?.rpe === "number" &&
                Array.isArray(log.swim_result?.snapshot?.strokes) &&
                Array.isArray(log.swim_result?.snapshot?.equipment)).toBe(true);
            }
            const log = sample.logs[0];
            const reached = sample.logs.length === 1 && log.id === originalLog.id &&
              log.client_log_id === originalLog.client_log_id &&
              log.swim_result.lengths === 12 && log.swim_result.timeMs === 600000 &&
              log.swim_result.rpe === 8 && log.swim_result.snapshot.strokes.length === 1 &&
              log.swim_result.snapshot.strokes[0] === "freestyle" &&
              log.swim_result.snapshot.equipment.length === 1 &&
              log.swim_result.snapshot.equipment[0] === "pull_buoy";
            editDiagnostic.backend = reached ? "reached" : "not-reached";
            return reached ? "reached" as const : "not-reached" as const;
          }).catch(() => {
            if (!active()) return "expired" as const;
            editDiagnostic.backend = "unavailable";
            return "read-error" as const;
          });
          owned.push(backend);
          const alert = page.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)
            .then(({ count, category }) => {
              if (!active()) return "expired" as const;
              editDiagnostic.category = validateAlertCategory(category);
              return count < 0 ? "structural-error" as const : count > 0 ? "alert" as const : "absent" as const;
            }, () => {
              if (!active()) return "expired" as const;
              editDiagnostic.category = "unavailable";
              return "read-error" as const;
            });
          owned.push(alert);
          const [backendOutcome, alertOutcome] = await Promise.all([backend, alert]);
          if (!active()) return "expired" as const;
          if (backendOutcome === "read-error") return "backend-read-error" as const;
          if (alertOutcome === "read-error") return "alert-read-error" as const;
          if (alertOutcome === "structural-error") return "alert-structural-error" as const;
          if (alertOutcome === "alert") return "alert" as const;
          if (backendOutcome === "reached") return "backend" as const;
          const remaining = deadline - performance.now();
          if (remaining <= 0) return "expired" as const;
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
        return "expired" as const;
      })().then((outcome) => outcome, () => "observation-error" as const);
      owned.push(polling);
      expect(deadline - performance.now()).toBeGreaterThan(0);
      const requestOutcome = await requestWaiter;
      expect(requestOutcome).toBe("seen");
      expect(deadline - performance.now()).toBeGreaterThan(0);
      const responseOutcome = await responseWaiter;
      expect(responseOutcome.outcome).toBe("seen");
      expect(responseOutcome.paired).toBe(true);
      expect(responseOutcome.status).toBe(200);
      expect(deadline - performance.now()).toBeGreaterThan(0);
      const observationOutcome = await Promise.race([polling, expired]);
      expect(observationOutcome).not.toBe("backend-read-error");
      expect(observationOutcome).not.toBe("alert-read-error");
      expect(observationOutcome).not.toBe("alert-structural-error");
      expect(observationOutcome).not.toBe("observation-error");
      expect(observationOutcome).not.toBe("alert");
      expect(observationOutcome).toBe("backend");
      const remaining = deadline - performance.now();
      expect(remaining).toBeGreaterThan(0);
      try {
        await expect(result).toContainText("12 lengths · 10:00 · RPE 8", { timeout: remaining });
      } catch (error) {
        // Stop old observation writes before the later failure-only sample.
        controller.abort();
        await captureFailureView(editDiagnostic).catch(() => undefined);
        throw error;
      }
    } finally {
      controller.abort();
      clearTimeout(editExpiry);
      await Promise.allSettled(owned);
      const annotation = alertAnnotation(editDiagnostic);
      if (annotation) testInfo.annotations.push(annotation);
    }
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

  test("A3, DC-SW7: replacing an archived swim plan preserves completed history and primary training", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryBaseline(admin, userId);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    const issued = await lifecycleState(admin, userId);
    expect(issued.plans.length === 1 && issued.workouts.length === 4).toBe(true);
    await page.getByRole("link").filter({ hasText: "Scheduled" }).first().click();
    await page.getByRole("button", { name: "Start swim", exact: true }).click();
    await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
    await page.getByLabel("Whole lengths", { exact: true }).fill("16");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("15:00");
    await page.getByRole("radio", { name: "6 moderate", exact: true }).click();
    await page.getByRole("button", { name: "Finish swim", exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeVisible();
    await page.goto(original.url);
    await page.getByRole("link").filter({ hasText: "Scheduled" }).first().click();
    await page.getByRole("button", { name: "Start swim", exact: true }).click();
    await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
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
    await page.getByRole("link", { name: "Set up swimming", exact: true }).click();
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
    await page.getByLabel("Recent comfortable continuous lengths", { exact: true }).fill("4");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
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
      await page.getByRole("navigation", { name: "Swim plans", exact: true })
        .getByRole("link", { name: new RegExp(`${status}$`) }).click();
      await page.reload();
      const choices = page.getByRole("navigation", { name: "Swim plans", exact: true });
      await expect(choices.getByRole("link")).toHaveCount(2);
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
        await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
        await page.goto(original.url);
      } else {
        await expect(page.getByRole("link").filter({ hasText: "Scheduled" })).toHaveCount(4);
        await expect(page.getByRole("link").filter({ hasText: "Completed" })).toHaveCount(0);
      }
    }
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), replaced)).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
  });

  test("A4, DC-SW7/DC-SW8/DC-SW9: an offline swim finishes after archival without duplicate history or load", async ({
    page, context, browser, freshUser, seedConfig, admin, baseURL,
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const primary = await primaryBaseline(admin, userId);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const original = await createPlan(page);
    await page.getByRole("link").filter({ hasText: "Scheduled" }).first().click();
    await page.getByRole("button", { name: "Start swim", exact: true }).click();
    await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
    const before = await lifecycleState(admin, userId);
    const started = before.workouts.find((row) => row.status === "started");
    expect(!!started?.session_id && before.workouts.filter((row) => row.status === "started").length === 1).toBe(true);
    if (!started?.session_id) throw new Error("Missing started synthetic swim.");
    expect(before.logs.length).toBe(0);
    expect(before.sessions.length).toBe(2);
    const native = before.sessions.find((row) => row.id === started.session_id)!;
    expect(native.completed_at === null && native.completion_outbox_entry_id === null).toBe(true);
    expect(isDeepStrictEqual(await primary.snapshot(), primary.initial)).toBe(true);
    await page.getByLabel("Whole lengths", { exact: true }).fill("16");
    await page.getByLabel("Time · min:sec", { exact: true }).fill("15:00");
    await page.getByRole("radio", { name: "6 moderate", exact: true }).click();
    await page.getByText("Notes, changes and splits", { exact: true }).click();
    await page.getByRole("combobox", { name: "Stroke", exact: true }).selectOption("breaststroke");
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish swim", exact: true }).click();
    await expect(page.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled();
    const queued = await lifecycleQueue(page);
    expect(queued.length).toBe(1);
    const entry = queued[0];
    expect(entry.op === "swim_complete" && isUuid(entry.id) && entry.attempts === 0).toBe(true);
    expect(isDeepStrictEqual(
      [entry.sessionId, entry.payload.sessionId, entry.payload.workoutId],
      [started.session_id, started.session_id, started.id],
    )).toBe(true);
    expect(isDeepStrictEqual(
      [entry.payload.lengths, entry.payload.timeMs, entry.payload.rpe, entry.payload.stroke, entry.payload.expectedRevision],
      ["16", "900000", "6", "breaststroke", String(started.revision)],
    )).toBe(true);
    expect(isDeepStrictEqual(await lifecycleState(admin, userId), before)).toBe(true);

    const online = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, hasTouch: true });
    let bodyFailed = false;
    try {
      await signInAs(online, freshUser, seedConfig, baseURL!);
      const archivePage = await online.newPage();
      await archivePage.goto(original.url);
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
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      expect(isDeepStrictEqual(await lifecycleQueue(page), queued)).toBe(true);

      let completionRequest: Request | undefined;
      const capture = (request: Request) => {
        if (request.method() !== "POST" || !request.headers()["next-action"]) return;
        const body = request.postData() ?? "";
        if ([entry.id, entry.sessionId, started.id].every((id) => body.includes(id))) completionRequest ??= request;
      };
      page.on("request", capture);
      try {
        await context.setOffline(false);
        await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeVisible();
      } finally {
        page.off("request", capture);
      }
      expect(completionRequest !== undefined).toBe(true);
      expect((await lifecycleQueue(page)).length).toBe(0);
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
        [16, 900000, 6, ["breaststroke"]],
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
      expect(countsTowardAdherence(settled)).toBe(false);
      expect(countsTowardProgression(settled)).toBe(false);
      expect(settled.actualMs).toBe(900000);
      expect(deriveSwimWeekCandidate(completed.plans[0], completed.history, todayYmd(timezone)) === null).toBe(true);
      lifecycleLedger(completed, timezone);
      expect(Number(completed.regions.find((row) => row.region === "adductor_groin")?.atl) > 0).toBe(true);

      // Replay the captured queue request, not a fresh Finish action or receipt.
      if (!completionRequest) throw new Error("Missing original queued completion request.");
      const replay = await context.request.fetch(completionRequest).catch(() => {
        throw new Error("Original completion replay transport failed.");
      });
      expect(replay.ok()).toBe(true);
      const replayAccepted = (await replay.text()).split("\n").some((line) => {
        try {
          const value = JSON.parse(line.slice(line.indexOf(":") + 1));
          return value?.ok === true || value?.a?.ok === true;
        } catch { return false; }
      });
      expect(replayAccepted).toBe(true);
      await replay.dispose();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      expect((await lifecycleQueue(page)).length).toBe(0);
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
      await expect(page.getByRole("navigation", { name: "Swim plans", exact: true })).toHaveCount(0);
    } catch (error) {
      bodyFailed = true;
      throw error;
    } finally {
      const closed = await online.close().then(() => true, () => false);
      if (!bodyFailed) expect(closed).toBe(true);
    }
  });
});
