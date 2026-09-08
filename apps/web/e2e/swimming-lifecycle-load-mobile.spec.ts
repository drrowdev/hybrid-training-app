import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
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

async function nativeRows(admin: SupabaseClient, userId: string, sessionId: string) {
  const [session, logs] = await Promise.all([
    admin.from("sessions")
      .select("id,user_id,performed_at,completed_at,deleted_at,completion_outbox_entry_id,duration_min,session_rpe")
      .eq("user_id", userId).eq("id", sessionId).single<NativeSession>(),
    admin.from("cardio_logs")
      .select("id,session_id,client_log_id,modality,duration_sec,distance_km,rpe,hr_zones,swim_result")
      .eq("session_id", sessionId).returns<NativeLog[]>(),
  ]);
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

test.describe("ADR0079 mobile swimming lifecycle and regional load", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });
  test.skip(!swimE2EEnabled(process.env), "Blocked: swimming E2E was not explicitly requested.");

  test("A1, DC-SW7: pause, preview, resume, finish and archive preserve primary training and issued swims", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
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
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.locator("main > section").first().getByText("Paused", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Preview dates", exact: true }).click();
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
    for (const [control, status, label] of [
      ["Finish plan", "finished", "Finished"],
      ["Archive", "archived", "Archived"],
    ] as const) {
      await page.getByRole("button", { name: control, exact: true }).click();
      await expect(page.locator("main > section").first().getByText(label, { exact: true })).toBeVisible();
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, status);
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
  }) => {
    const userId = freshUser.userId;
    await markOnboarded(admin, userId);
    const timezone = await userTimezone(admin, userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    expect(await regionRows(admin, userId)).toEqual([]);
    const { planId } = await createPlan(page);
    const scheduled = await savedPlan(admin, userId, planId);
    const workout = scheduled.workouts[0];
    await page.getByRole("link").and(page.locator(`[href="/app/swim/${workout.id}"]`)).click();
    await page.getByRole("button", { name: "Start swim", exact: true }).click();
    await expect.poll(async () => {
      const saved = (await savedPlan(admin, userId, planId)).workouts.find((row) => row.id === workout.id);
      return saved?.status === "started" && typeof saved.session_id === "string" && saved.session_id.length > 0;
    }).toBe(true);
    await expect(page.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
});
