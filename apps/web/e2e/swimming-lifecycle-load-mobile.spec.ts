import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription } from "@hta/db";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedRecentBlock, seedPlannedSessionsForBlock } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd } from "../src/lib/dates";
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
  const blockId = await seedRecentBlock(admin, userId, { status: "active", weeks: 2 });
  const plannedIds = await seedPlannedSessionsForBlock(admin, userId, blockId, {
    totalSessions: 2, loggedCount: 1,
  });
  const movementId = randomUUID();
  const movement = await admin.from("movements").insert({
    id: movementId, user_id: userId, slug: `e2e-squat-${movementId}`,
    display_name: "Acceptance squat", pattern: "squat", primary_region: "knee",
    functional_roles: ["quad_dominant_squat"], is_compound: true,
  });
  expect(movement.error).toBeNull();
  const prescription: Prescription = {
    items: [{ movementId, movementName: "Acceptance squat", kind: "main", sets: 3, reps: 5 }],
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
      admin.from("movements").select("*").eq("user_id", userId).eq("id", movementId),
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
    expect(created.plan.state.lifecycle ?? []).toEqual([]);
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
    await page.goto(url);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
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
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    const resumed = await savedPlan(admin, freshUser.userId, planId);
    lifecycleTransition(paused.plan, resumed.plan, "active");
    expect(resumed.workouts.find((row) => row.id === first.id)).toEqual(protectedSwim);
    for (const [index, row] of future.entries()) {
      expect(resumed.workouts.find((saved) => saved.id === row.id)).toEqual({
        ...row, scheduled_date: dates[index], revision: row.revision + 1, updated_at: expect.any(String),
      });
    }
    expect(resumed.plan.state.decisions).toHaveLength(paused.plan.state.decisions.length + 1);
    expect(resumed.plan.state.decisions.at(-1)).toMatchObject({ kind: "schedule", decision: "accepted" });
    expect(await primary.snapshot()).toEqual(primary.initial);
    let previous = resumed;
    for (const [control, status, label] of [
      ["Finish plan", "finished", "Finished"],
      ["Archive", "archived", "Archived"],
    ] as const) {
      await page.getByRole("button", { name: control, exact: true }).click();
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      const saved = await savedPlan(admin, freshUser.userId, planId);
      lifecycleTransition(previous.plan, saved.plan, status);
      expect(saved.workouts).toEqual(resumed.workouts);
      expect(saved.plan.state.decisions).toEqual(resumed.plan.state.decisions);
      expect(await primary.snapshot()).toEqual(primary.initial);
      previous = saved;
    }
    await page.reload();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();
    expect(await savedPlan(admin, freshUser.userId, planId)).toEqual(previous);
    expect(await primary.snapshot()).toEqual(primary.initial);
  });
});
