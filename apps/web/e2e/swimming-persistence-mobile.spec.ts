import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { workoutPresentation } from "../src/lib/swim/presentation";
import type { SwimPlanRow, SwimWorkoutRow } from "../src/lib/swim/storage";

const mobile = { viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true };

const test = seededTest.extend({
  // Validate before seedConfig can enable any user creation or sign-in.
  seedConfig: async ({ baseURL }, use) => {
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1") {
      throw new Error("Swimming persistence requires the dedicated disposable loopback environment.");
    }
    if (!baseURL || !URL.canParse(baseURL) || process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
      throw new Error("Swimming persistence requires an explicit loopback HTTP baseURL.");
    }
    const target = new URL(baseURL);
    if (target.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Swimming persistence requires an explicit loopback HTTP baseURL.");
    }
    const {
      E2E_SUPABASE_URL: supabaseUrl,
      E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Swimming persistence requires explicit dedicated seed configuration.");
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
});

async function createPlan(page: Page, pool: "25yd" | "50m") {
  await page.goto("/app/swim/setup");
  await page.getByLabel("Pool length", { exact: true }).selectOption(pool);
  await page.getByLabel("Recent comfortable continuous lengths").fill("4");
  await page.getByLabel("Weeks", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/swim\?plan=[^&]+$/);
  await expect(page.getByRole("heading", { name: "Swims", exact: true })).toBeVisible();
  return page.url();
}

async function savedState(admin: SupabaseClient, userId: string) {
  const [plans, workouts] = await Promise.all([
    admin.from("swim_plans").select("*").eq("user_id", userId).order("id").returns<SwimPlanRow[]>(),
    admin.from("swim_workouts").select("*").eq("user_id", userId).order("scheduled_date").order("id").returns<SwimWorkoutRow[]>(),
  ]);
  expect(plans.error).toBeNull();
  expect(workouts.error).toBeNull();
  expect(plans.data).toHaveLength(1);
  expect(workouts.data).toHaveLength(4);
  if (!plans.data || !workouts.data) throw new Error("Missing saved swim rows.");
  for (const workout of workouts.data) {
    expect(workout.user_id).toBe(userId);
    expect(workout.plan_id).toBe(plans.data[0].id);
    expect(workout.definition.issued.snapshot.course).toEqual(plans.data[0].definition.setup.course);
    expect(workout.definition.issued.totalLengths).toBeGreaterThan(0);
  }
  return { plans: plans.data, workouts: workouts.data };
}

async function openSavedWorkout(page: Page, planURL: string, saved: Awaited<ReturnType<typeof savedState>>) {
  await page.goto(planURL);
  await expect(page).toHaveURL(planURL);
  const swims = page.getByRole("heading", { name: "Swims", exact: true }).locator("..");
  await expect(swims.getByRole("link")).toHaveCount(saved.workouts.length);
  for (const workout of saved.workouts) {
    const link = swims.getByRole("link").and(page.locator(`[href="/app/swim/${workout.id}"]`));
    const view = workoutPresentation(workout.definition.issued);
    await expect(link).toContainText(view.title);
    await expect(link).toContainText(view.total);
  }
  const workout = saved.workouts[0];
  await swims.getByRole("link").and(page.locator(`[href="/app/swim/${workout.id}"]`)).click();
  await expect(page).toHaveURL(new URL(`/app/swim/${workout.id}`, planURL).href);
  const view = workoutPresentation(workout.definition.issued);
  await expect(page.getByRole("heading", { name: view.title, exact: true })).toBeVisible();
  await expect(page.getByText(view.course, { exact: true })).toBeVisible();
  const prescription = page.getByRole("heading", { name: "Workout", exact: true }).locator("..");
  const steps = prescription.getByRole("listitem");
  await expect(steps).toHaveCount(view.steps.length);
  for (const [index, step] of view.steps.entries()) {
    await expect(steps.nth(index)).toContainText(step.title);
    await expect(steps.nth(index)).toContainText(step.detail);
    await expect(steps.nth(index)).toContainText(step.effort);
    await expect(steps.nth(index)).toContainText(step.rest);
  }
  return page.url();
}

test.describe("ADR0079 mobile swimming persistence and isolation", () => {
  test.use(mobile);
  test.skip(
    !swimE2EEnabled(process.env),
    "Blocked: swimming E2E was not explicitly requested.",
  );

  test("DC-SW1/DC-SW8: native course and planned workouts survive reload and a second same-user mobile context", async ({
    page, context, browser, freshUser, seedConfig, admin, baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const planURL = await createPlan(page, "25yd");
    const saved = await savedState(admin, freshUser.userId);
    expect(saved.plans[0].id).toBe(new URL(planURL).searchParams.get("plan"));
    expect(saved.plans[0].definition.setup.course).toEqual({ numerator: 25, denominator: 1, unit: "yd" });
    for (const workout of saved.workouts) {
      expect(workout.status).toBe("scheduled");
      expect(workout.session_id).toBeNull();
    }
    await page.reload();
    await openSavedWorkout(page, planURL, saved);
    await expect(page.getByRole("button", { name: "Start swim", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Workout", exact: true })).toBeVisible();
    expect(await savedState(admin, freshUser.userId)).toEqual(saved);

    const secondContext = await browser.newContext({ ...mobile, baseURL });
    try {
      await signInAs(secondContext, freshUser, seedConfig, baseURL!);
      const secondPage = await secondContext.newPage();
      await openSavedWorkout(secondPage, planURL, saved);
      await expect(secondPage.getByRole("button", { name: "Start swim", exact: true })).toBeEnabled();
      expect(await savedState(admin, freshUser.userId)).toEqual(saved);
    } finally {
      await secondContext.close();
    }
  });
});
