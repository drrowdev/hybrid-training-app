import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { errors, type Page, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatSwimDistance, swimBenchmarkTrend, type SwimObservation } from "@hta/domain";
import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { test as seededTest, expect } from "./fixtures/seed";
import type { SeedConfig } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { workoutPresentation } from "../src/lib/swim/presentation";
import type { SwimPlanRow, SwimWorkoutRow } from "../src/lib/swim/storage";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout, listSwimPlans, listSwimWorkouts,
} from "../src/lib/swim/storage";
import { standaloneWeekRequests, type StandalonePlanDefinition, type StandaloneWorkoutDefinition } from "../src/lib/swim/model";
import { loadSwimHistory, loadSwimHubView } from "../src/lib/swim/queries";
import { addDaysToYmd, mondayOfYmd } from "../src/lib/dates";
import { formatSwimTime } from "../src/lib/swim/time";
import {
  SWIM_ALERT_CODEBOOK, alertAnnotation, classifyAlertNodes, startBackend,
  unavailableAlert, validateAlertCategory,
} from "../scripts/swim-alert-membership";

const mobile = { viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true };

const test = seededTest.extend<{
  secondUser: { email: string; password: string; userId: string };
}>({
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
  secondUser: async ({ admin }, use) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    if (!created.data.user) throw new Error("Missing synthetic second user.");
    const userId = created.data.user.id;
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use({ email, password, userId });
    } finally {
      const deleted = await admin.auth.admin.deleteUser(userId);
      expect(deleted.error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user).toBeNull();
      expect(remaining.error?.status).toBe(404);
    }
  },
});

async function createPlan(page: Page, pool: "25yd" | "50m") {
  await page.goto("/app/swim/setup");
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption(pool);
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
  await expect(page.locator("main > section").first().getByText(view.course, { exact: true })).toBeVisible();
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

async function analyticsActor(admin: SupabaseClient, user: { userId: string; email: string; password: string }, config: SeedConfig) {
  await markOnboarded(admin, user.userId);
  const profile = await admin.from("profiles").update({ timezone: "UTC" })
    .eq("id", user.userId).select("timezone").single();
  expect(profile.error === null && profile.data?.timezone === "UTC").toBe(true);
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword(user);
  expect(signedIn.error === null && signedIn.data.user?.id === user.userId).toBe(true);
  return client;
}

async function arrangeAnalytics(client: SupabaseClient, today: string, observations: SwimObservation[] = []) {
  const startDate = addDaysToYmd(mondayOfYmd(today), -7);
  const setup = {
    goal: "technique_base" as const, experience: "recreational" as const,
    course: { numerator: 25, denominator: 1, unit: "m" as const },
    knownStrokes: ["freestyle" as const], equipment: [],
    recentComfortableLengths: 12, sessionBudgetMinutes: 60,
  };
  const generated = generateSwimPlan({
    setup, calibration: null, weeks: standaloneWeekRequests(startDate, 2, [1, 4]),
  });
  if (!generated.ok) throw new Error("Synthetic analytics generation failed.");
  const definition: StandalonePlanDefinition = {
    version: 1, setup, generatorVersion: SWIM_GENERATOR_VERSION,
    schedule: { startDate, weeks: 2, weekdays: [1, 4] }, initialDose: generated.value.dose,
  };
  return createSwimPlan(client, {
    startedOn: startDate, endsOn: addDaysToYmd(startDate, 13), definition,
    state: { version: 1, observations, acceptedCalibration: null, decisions: [] },
    workouts: generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
      if (slot.kind !== "workout") throw new Error("Missing synthetic analytics workout.");
      const definition: StandaloneWorkoutDefinition = {
        version: 1, original: slot.original, issued: slot.issued, modifications: [],
        weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
      };
      return { scheduled_date: slot.dateISO, slot: "single" as const, definition };
    })),
  });
}

async function analyticsState(client: SupabaseClient, userId: string) {
  const plans = await listSwimPlans(client);
  const workouts = await listSwimWorkouts(client);
  expect(plans.length === 1 && plans.every((row) => row.user_id === userId)).toBe(true);
  expect(workouts.length === 4 && workouts.every((row) =>
    row.user_id === userId && row.plan_id === plans[0].id)).toBe(true);
  const sessions = await client.from("sessions").select("*").order("id");
  const logs = await client.from("cardio_logs").select("*").order("id");
  expect(sessions.error === null && logs.error === null).toBe(true);
  expect(sessions.data !== null && sessions.data.every((row) => row.user_id === userId)).toBe(true);
  expect(logs.data !== null && logs.data.every((row) =>
    sessions.data!.some((session) => session.id === row.session_id))).toBe(true);
  expect(sessions.data!.every((session) => session.completed_at !== null &&
    logs.data!.filter((row) => row.session_id === session.id && row.swim_result !== null).length === 1)).toBe(true);
  return {
    plans, workouts, sessions: sessions.data!, logs: logs.data!,
    history: await loadSwimHistory(client, workouts),
  };
}

async function expectWeeklyAnalytics(page: Page, view: Awaited<ReturnType<typeof loadSwimHubView>>) {
  const rows = page.getByRole("table", { name: "Weekly distance by pool", exact: true }).locator("tbody tr");
  await expect(rows).toHaveCount(view.analytics.weeks.length);
  for (const [index, week] of view.analytics.weeks.entries()) {
    await expect(rows.nth(index).locator("th, td")).toHaveText([
      week.week, week.course, week.planned, week.actual, String(week.frequency), week.adherence,
    ]);
  }
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

  test("DC-SW1/DC-SW8: two mobile users retain distinct usable plans and cannot start or change each other's workouts", async ({
    page, context, browser, freshUser, secondUser, seedConfig, admin, baseURL,
  }, testInfo) => {
    expect(secondUser.userId).not.toBe(freshUser.userId);
    await markOnboarded(admin, freshUser.userId);
    await markOnboarded(admin, secondUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const secondContext = await browser.newContext({ ...mobile, baseURL });
    try {
      await signInAs(secondContext, secondUser, seedConfig, baseURL!);
      const secondPage = await secondContext.newPage();
      const firstPlanURL = await createPlan(page, "25yd");
      const secondPlanURL = await createPlan(secondPage, "50m");
      const firstSaved = await savedState(admin, freshUser.userId);
      const secondSaved = await savedState(admin, secondUser.userId);
      expect(firstSaved.plans[0].id).toBe(new URL(firstPlanURL).searchParams.get("plan"));
      expect(secondSaved.plans[0].id).toBe(new URL(secondPlanURL).searchParams.get("plan"));
      expect(firstSaved.plans[0].id).not.toBe(secondSaved.plans[0].id);
      expect(firstSaved.plans[0].definition.setup.course).toEqual({ numerator: 25, denominator: 1, unit: "yd" });
      expect(secondSaved.plans[0].definition.setup.course).toEqual({ numerator: 50, denominator: 1, unit: "m" });
      const ids = [...firstSaved.workouts, ...secondSaved.workouts].map((workout) => workout.id);
      expect(new Set(ids).size).toBe(8);
      for (const workout of [...firstSaved.workouts, ...secondSaved.workouts]) {
        expect(workout.status).toBe("scheduled");
        expect(workout.session_id).toBeNull();
      }
      const firstWorkoutURL = await openSavedWorkout(page, firstPlanURL, firstSaved);
      const secondWorkoutURL = await openSavedWorkout(secondPage, secondPlanURL, secondSaved);
      for (const ownerPage of [page, secondPage]) {
        await expect(ownerPage.getByRole("button", { name: "Start swim", exact: true })).toBeEnabled();
      }

      for (const { visitor, foreignURL } of [
        { visitor: page, foreignURL: secondWorkoutURL },
        { visitor: secondPage, foreignURL: firstWorkoutURL },
      ]) {
        for (const url of [foreignURL, `${foreignURL}?edit=1`]) {
          await visitor.goto(url);
          await expect(visitor).toHaveURL(url);
          // The owned workout route calls Next's notFound(), including for edit=1.
          await expect(visitor.getByRole("heading", { name: "404", exact: true })).toBeVisible();
          await expect(visitor.getByRole("heading", { name: "Workout", exact: true })).toHaveCount(0);
          await expect(visitor.getByRole("button", { name: /^(Start swim|Skip swim|Finish swim|Save changes|Edit result)$/ })).toHaveCount(0);
          await expect(visitor.getByRole("link", { name: "Log swim", exact: true })).toHaveCount(0);
          await expect(visitor.getByRole("group", { name: "Swim result", exact: true })).toHaveCount(0);
        }
      }
      await openSavedWorkout(page, firstPlanURL, firstSaved);
      await openSavedWorkout(secondPage, secondPlanURL, secondSaved);
      expect(await savedState(admin, freshUser.userId)).toEqual(firstSaved);
      expect(await savedState(admin, secondUser.userId)).toEqual(secondSaved);

      for (const { ownerPage, ownerUserId, workoutId } of [
        { ownerPage: page, ownerUserId: freshUser.userId, workoutId: firstSaved.workouts[0].id },
        { ownerPage: secondPage, ownerUserId: secondUser.userId, workoutId: secondSaved.workouts[0].id },
      ]) {
        const { origin, pathname } = new URL(ownerPage.url());
        let actionRequest: Request | undefined;
        const requestWaiter = ownerPage.waitForRequest((request) => {
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
        const responseWaiter = ownerPage.waitForResponse(
          (response) => actionRequest !== undefined && response.request() === actionRequest,
          { timeout: 5000 },
        ).then(
          (response) => ({ outcome: "seen", paired: response.request() === actionRequest, status: response.status() }),
          (error: unknown) => ({
            outcome: error instanceof errors.TimeoutError ? "timeout" : "error", paired: false, status: null,
          }),
        );
        await ownerPage.getByRole("button", { name: "Start swim", exact: true }).click();
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
        const diagnostic = unavailableAlert(ownerPage === page ? "c4-owner-1-start" : "c4-owner-2-start");
        try {
          // Bound polling and the late sample without a sleep or a renewed deadline.
          const expired = new Promise<"pending">((resolve) => {
            expiry = setTimeout(() => resolve("pending"), backendBudget);
          });
          const captureAlert = async () => {
            if (performance.now() >= deadline) return;
            const category = await Promise.race([
              ownerPage.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)
                .then(({ category }) => category).then(validateAlertCategory, () => "unavailable" as const),
              expired.then(() => "unavailable" as const),
            ]);
            diagnostic.category = performance.now() < deadline ? category : "unavailable";
          };
          const polling = (async () => {
            while (performance.now() < deadline) {
              const { count } = await ownerPage.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK);
              if (count < 0) return "error" as const;
              if (count > 0) return "alert" as const;
              if (performance.now() >= deadline) return "pending" as const;
              const saved = await savedState(admin, ownerUserId);
              if (performance.now() >= deadline) return "pending" as const;
              const workout = saved.workouts.find((row) => row.id === workoutId);
              if (workout?.status === "started" &&
                typeof workout.session_id === "string" && workout.session_id.length > 0) {
                diagnostic.backend = startBackend(workout.status, workout.session_id);
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
              await Promise.race([
                Promise.all([
                  captureAlert(),
                  (async () => {
                    const sample = await admin.from("swim_workouts").select("status,session_id")
                      .eq("user_id", ownerUserId).eq("id", workoutId).abortSignal(controller.signal).single();
                    if (performance.now() < deadline && !sample.error && sample.data) {
                      diagnostic.backend = startBackend(sample.data.status, sample.data.session_id);
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
          await expect(ownerPage.getByRole("link", { name: "Log swim", exact: true })).toBeVisible({ timeout: visibilityBudget });
          expect(deadline - performance.now()).toBeGreaterThan(0);
          // One late sample, not continuous alert coverage during rendering.
          const lateAlertCount = await Promise.race([
            ownerPage.getByRole("alert").evaluateAll(classifyAlertNodes, SWIM_ALERT_CODEBOOK)
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
      }
      const firstStarted = await savedState(admin, freshUser.userId);
      const secondStarted = await savedState(admin, secondUser.userId);
      expect(firstStarted.workouts[0].status).toBe("started");
      expect(secondStarted.workouts[0].status).toBe("started");
      expect(firstStarted.workouts[0].session_id).toEqual(expect.any(String));
      expect(secondStarted.workouts[0].session_id).toEqual(expect.any(String));
      expect(firstStarted.workouts[0].session_id).not.toBe(secondStarted.workouts[0].session_id);
    } finally {
      await secondContext.close();
    }
  });

  test("E1 DC-SW1/DC-SW6: weekly swimming analytics keep native pool courses separate", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    try {
      const actor = await analyticsActor(admin, freshUser, seedConfig);
      const today = new Date().toISOString().slice(0, 10);
      const observations: SwimObservation[] = (["m", "yd"] as const).map((unit) => ({
        protocol: "css_200_400", version: "swim-css-1", observedOn: today, verified: false,
        course: { numerator: 25, denominator: 1, unit }, stroke: "freestyle", equipment: [],
        trials: [
          { distance: 200, lengths: 8, timeMs: unit === "m" ? 180000 : 160000 },
          { distance: 400, lengths: 16, timeMs: unit === "m" ? 420000 : 360000 },
        ],
      }));
      // Storage arrangement is not evidence of logging or assessment UI actions.
      const created = await arrangeAnalytics(actor, today, observations);
      for (const [index, unit] of (["m", "yd", "m"] as const).entries()) {
        const workout = created.workouts[index];
        const started = await startSwimWorkout(actor, workout.id, workout.revision);
        await completeSwimWorkout(actor, {
          workoutId: started.id, expectedRevision: started.revision,
          clientLogId: randomUUID(), completionEntryId: randomUUID(), allowChangedCourse: unit === "yd",
          result: {
            version: 1, snapshot: { ...started.definition.issued.snapshot,
              course: { numerator: 25, denominator: 1, unit } },
            lengths: unit === "yd" ? 16 : 8, timeMs: 420000, rpe: 5, completion: "completed",
            provenance: { source: "manual", recordedAt: `${today}T12:00:00Z` },
          },
        });
      }
      const before = await analyticsState(actor, freshUser.userId);
      expect(before.sessions.length === 3 && before.logs.length === 3).toBe(true);
      expect(isDeepStrictEqual(before.plans[0].state, created.plan.state)).toBe(true);
      expect(isDeepStrictEqual(before.workouts.map((row) => row.definition),
        created.workouts.map((row) => row.definition))).toBe(true);
      const view = await loadSwimHubView(actor, freshUser.userId, before.plans[0]);
      const actual = view.analytics.weeks.filter((row) => row.week === mondayOfYmd(today));
      expect(isDeepStrictEqual(actual.map(({ course, actual, frequency }) => ({ course, actual, frequency })), [
        { course: "25 m", actual: "400 m", frequency: 2 },
        { course: "25 yd", actual: "400 yd", frequency: 1 },
      ])).toBe(true);
      expect(view.assessment).toBeUndefined();
      expect(view.analytics.bests).toHaveLength(4);
      expect(isDeepStrictEqual(view.analytics.bests.map(({ label, time }) => [label, time]), [
        ["200 m · 25 m · Freestyle", "3:00"], ["400 m · 25 m · Freestyle", "7:00"],
        ["200 yd · 25 yd · Freestyle", "2:40"], ["400 yd · 25 yd · Freestyle", "6:00"],
      ])).toBe(true);
      for (const observation of observations) {
        const trend = swimBenchmarkTrend(observations, observation);
        expect(trend.excluded).toHaveLength(0);
        expect(isDeepStrictEqual(trend.personalBests.map(({ distance, timeMs }) => ({ distance, timeMs })),
          observation.trials.map(({ distance, timeMs }) => ({ distance, timeMs })))).toBe(true);
      }
      await signInAs(context, freshUser, seedConfig, baseURL!);
      await page.goto(`/app/swim?plan=${created.plan.id}`);
      await page.locator(`a[href="/app/swim/${created.workouts[1].id}"]`).click();
      const nativeResult = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
      await expect(nativeResult).toContainText("400 yd");
      await expect(nativeResult).toContainText("25 yd");
      await page.reload();
      await expect(nativeResult).toContainText("400 yd");
      await page.goto(`/app/swim?plan=${created.plan.id}`);
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expectWeeklyAnalytics(page, view);
        const bests = page.getByRole("heading", { name: "Best swims", exact: true })
          .locator("xpath=following-sibling::ul[1]").getByRole("listitem");
        await expect(bests).toHaveCount(4);
        for (const [index, best] of view.analytics.bests.entries()) {
          await expect(bests.nth(index)).toContainText(best.label);
          await expect(bests.nth(index)).toContainText(best.time);
        }
        expect(isDeepStrictEqual(await analyticsState(actor, freshUser.userId), before)).toBe(true);
        expect(isDeepStrictEqual(await loadSwimHubView(actor, freshUser.userId, before.plans[0]), view)).toBe(true);
      }
    } finally {
      const deleted = await admin.auth.admin.deleteUser(freshUser.userId);
      expect(deleted.error === null).toBe(true);
      const remaining = await admin.auth.admin.getUserById(freshUser.userId);
      expect(remaining.data.user === null && remaining.error?.status === 404).toBe(true);
    }
  });

  test("E2 DC-SW2/DC-SW6: ordinary swim results do not create a pace calibration", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    try {
      const actor = await analyticsActor(admin, freshUser, seedConfig);
      const today = new Date().toISOString().slice(0, 10);
      const created = await arrangeAnalytics(actor, today);
      // These ordinary manual results resemble a pair, but carry no assessment protocol.
      for (const [index, lengths] of [8, 16].entries()) {
        const workout = created.workouts[index];
        const started = await startSwimWorkout(actor, workout.id, workout.revision);
        await completeSwimWorkout(actor, {
          workoutId: started.id, expectedRevision: started.revision,
          clientLogId: randomUUID(), completionEntryId: randomUUID(),
          result: {
            version: 1, snapshot: started.definition.issued.snapshot,
            lengths, timeMs: index === 0 ? 180000 : 420000, rpe: 5, completion: "completed",
            provenance: { source: "manual", recordedAt: `${today}T12:00:00Z` },
          },
        });
      }
      const before = await analyticsState(actor, freshUser.userId);
      expect(before.sessions.length === 2 && before.logs.length === 2).toBe(true);
      expect(isDeepStrictEqual(before.plans[0].state, {
        version: 1, observations: [], acceptedCalibration: null, decisions: [],
      })).toBe(true);
      expect(isDeepStrictEqual(before.workouts.map((row) => row.definition),
        created.workouts.map((row) => row.definition))).toBe(true);
      const view = await loadSwimHubView(actor, freshUser.userId, before.plans[0]);
      expect(view.assessment).toBeUndefined();
      expect(isDeepStrictEqual(view.analytics.bests, []) && isDeepStrictEqual(view.analytics.benchmarks, [])).toBe(true);
      expect(view.analytics.weeks.find((row) => row.week === mondayOfYmd(today))?.actual).toBe("600 m");
      const completed = before.history.filter((row) => row.result !== null);
      expect(completed).toHaveLength(2);
      expect(completed.every((row) => row.result!.snapshot.protocol === null &&
        row.result!.snapshot.calibration === null && row.result!.provenance.source === "manual")).toBe(true);
      expect(isDeepStrictEqual(completed.map((row) =>
        formatSwimDistance(row.result!.lengths, row.result!.snapshot.course)), ["200 m", "400 m"])).toBe(true);
      await signInAs(context, freshUser, seedConfig, baseURL!);
      await page.goto("/app/sessions");
      await expect(page.locator('a[href^="/app/sessions/"]:not([href="/app/sessions/new"])')).toHaveCount(2);
      for (const row of completed) {
        await page.locator(`a[href="/app/sessions/${row.workout.session_id}"]`).click();
        await expect(page).toHaveURL(new URL(`/app/swim/${row.workout.id}`, baseURL!).href);
        const result = page.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
        await expect(result).toContainText(formatSwimDistance(row.result!.lengths, row.result!.snapshot.course));
        await expect(result).toContainText(formatSwimTime(row.result!.timeMs));
        await expect(result).toContainText("RPE 5");
        await page.reload();
        await expect(result).toContainText(formatSwimDistance(row.result!.lengths, row.result!.snapshot.course));
        await page.goto("/app/sessions");
      }
      await page.goto(`/app/swim?plan=${created.plan.id}`);
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await expectWeeklyAnalytics(page, view);
        await expect(page.getByRole("heading", { name: /^(Best swims|Assessment history)$/ })).toHaveCount(0);
        expect(isDeepStrictEqual(await analyticsState(actor, freshUser.userId), before)).toBe(true);
        expect(isDeepStrictEqual(await loadSwimHubView(actor, freshUser.userId, before.plans[0]), view)).toBe(true);
      }
    } finally {
      const deleted = await admin.auth.admin.deleteUser(freshUser.userId);
      expect(deleted.error === null).toBe(true);
      const remaining = await admin.auth.admin.getUserById(freshUser.userId);
      expect(remaining.data.user === null && remaining.error?.status === 404).toBe(true);
    }
  });
});
