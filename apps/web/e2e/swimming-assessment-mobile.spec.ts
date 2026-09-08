import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  formatPoolCourse, SWIM_ASSESSMENT_VERSION, SWIM_EFFORT_PACE_FACTORS,
  type SwimObservation,
} from "@hta/domain";
import { SWIM_GENERATOR_VERSION } from "@hta/engine";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { startSwimWorkout, type SwimPlanRow, type SwimWorkoutRow } from "../src/lib/swim/storage";
import { formatSwimTime } from "../src/lib/swim/time";

// Source-only: coordinator registration and selected live acceptance remain deferred.
const test = seededTest.extend({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks. */
  seedConfig: async ({ baseURL }, use) => {
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1") {
      throw new Error("Swimming assessment requires the dedicated disposable loopback environment.");
    }
    if (!baseURL || !URL.canParse(baseURL) || process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
      throw new Error("Swimming assessment requires an explicit loopback HTTP baseURL.");
    }
    const target = new URL(baseURL);
    if (target.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Swimming assessment requires an explicit loopback HTTP baseURL.");
    }
    const {
      E2E_SUPABASE_URL: supabaseUrl,
      E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Swimming assessment requires explicit dedicated seed configuration.");
    }
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
  freshUser: async ({ admin }, use) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error === null).toBe(true);
    if (!created.data.user) throw new Error("Missing synthetic assessment user.");
    const userId = created.data.user.id;
    try {
      await use({ email, password, userId });
    } finally {
      const deleted = await admin.auth.admin.deleteUser(userId);
      expect(deleted.error === null).toBe(true);
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user === null).toBe(true);
      expect(remaining.error?.status).toBe(404);
    }
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

test.use({
  viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true,
  trace: "off", screenshot: "off", video: "off",
});

const course = { numerator: 25, denominator: 1, unit: "yd" } as const;
const rejectedTimes = [200_000, 420_000] as const;
const acceptedTimes = [190_000, 400_000] as const;
const acceptedPace = 105_000;

function observation(today: string, times: readonly [number, number]): SwimObservation {
  return {
    protocol: "css_200_400", course, stroke: "freestyle", equipment: [],
    observedOn: today, verified: true, version: SWIM_ASSESSMENT_VERSION,
    trials: [
      { distance: 200, lengths: 8, timeMs: times[0] },
      { distance: 400, lengths: 16, timeMs: times[1] },
    ],
  };
}

async function savedState(admin: SupabaseClient, userId: string) {
  const [plans, workouts] = await Promise.all([
    admin.from("swim_plans").select("*").eq("user_id", userId).order("id").returns<SwimPlanRow[]>(),
    admin.from("swim_workouts").select("*").eq("user_id", userId)
      .order("scheduled_date").order("id").returns<SwimWorkoutRow[]>(),
  ]);
  expect(plans.error === null).toBe(true);
  expect(workouts.error === null).toBe(true);
  expect(plans.data).toHaveLength(1);
  expect(workouts.data).toHaveLength(4);
  if (!plans.data || !workouts.data) throw new Error("Missing owned swim rows.");
  const plan = plans.data[0];
  expect(plan.user_id).toBe(userId);
  expect(new Set(workouts.data.map((row) => row.id)).size).toBe(4);
  for (const row of workouts.data) {
    expect(row.user_id).toBe(userId);
    expect(row.plan_id).toBe(plan.id);
    expect(row.definition.issued.totalLengths).toBeGreaterThan(0);
  }
  return { plan, workouts: workouts.data };
}

type Saved = Awaited<ReturnType<typeof savedState>>;

async function openDisclosure(details: Locator) {
  await expect(details).toHaveCount(1);
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

async function reviewAssessment(page: Page, today: string, times: readonly [number, number]) {
  const section = page.getByRole("heading", { name: "New assessment", exact: true }).locator("..");
  await openDisclosure(section.locator("details"));
  await section.getByLabel("200 time · min:sec", { exact: true }).fill(`${formatSwimTime(times[0])}.000`);
  await section.getByLabel("400 time · min:sec", { exact: true }).fill(`${formatSwimTime(times[1])}.000`);
  await section.getByLabel("Swum on", { exact: true }).fill(today);
  await section.getByRole("combobox", { name: "Assessment stroke", exact: true }).selectOption("freestyle");
  await section.getByRole("checkbox", {
    name: "Verified times, same pool and stroke, without equipment", exact: true,
  }).check();
  await section.getByRole("button", { name: "Review assessment", exact: true }).click();
  const preview = section.getByRole("list");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("listitem")).toHaveCount(1);
  await expect(preview).toContainText(`${formatPoolCourse(course)} · 200 / 400 yard estimate`);
  await expect(preview.locator("strong")).toHaveText(`${formatSwimTime((times[1] - times[0]) / 2)} / 100 yd`);
  await expect(section.getByRole("button", { name: "Accept assessment", exact: true })).toBeEnabled();
  await expect(section.getByRole("button", { name: "Reject assessment", exact: true })).toBeEnabled();
  return section;
}

function assertDecision(before: Saved, after: Saved, trial: SwimObservation, choice: "accepted" | "rejected") {
  const prior = before.plan.state.decisions;
  const decisions = after.plan.state.decisions;
  expect(decisions).toHaveLength(prior.length + 1);
  expect(decisions.slice(0, -1)).toEqual(prior);
  const record = decisions[decisions.length - 1];
  expect(record).toMatchObject({
    kind: "assessment", decision: choice,
    ruleVersion: SWIM_ASSESSMENT_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
    inputSnapshot: {
      observation: trial, revision: before.plan.revision,
      calibration: { msPer100: (trial.trials[1].timeMs - trial.trials[0].timeMs) / 2, unit: "yd", observation: trial },
      workouts: before.workouts.map((row) => ({ id: row.id, revision: row.revision, issued: row.definition.issued })),
    },
  });
  expect(record.id.length).toBeGreaterThan(0);
  expect(Number.isFinite(Date.parse(record.recordedAt))).toBe(true);
  expect(new Set(decisions.map((entry) => entry.id)).size).toBe(decisions.length);
  expect(after.plan).toEqual({
    ...before.plan, revision: before.plan.revision + 1, updated_at: after.plan.updated_at,
    state: {
      ...before.plan.state,
      observations: [...before.plan.state.observations, trial],
      decisions,
      acceptedCalibration: choice === "accepted" ? record.inputSnapshot.calibration : before.plan.state.acceptedCalibration,
    },
  });
  return record;
}

async function assertHistory(page: Page, today: string, accepted: boolean) {
  const history = page.getByRole("heading", { name: "Swimming history", exact: true }).locator("..");
  const listAfter = (name: string) => history.getByRole("heading", { name, exact: true, level: 3 })
    .locator("xpath=following-sibling::*[1][self::ul]").getByRole("listitem");
  const bests = listAfter("Best swims");
  const assessments = listAfter("Assessment history");
  await expect(bests).toHaveCount(2);
  await expect(assessments).toHaveCount(accepted ? 4 : 2);
  for (const [index, distance] of [200, 400].entries()) {
    const label = `${distance} yd · ${formatPoolCourse(course)} · Freestyle`;
    const best = bests.filter({ hasText: label });
    await expect(best).toHaveCount(1);
    await expect(best.locator("strong")).toHaveText(formatSwimTime((accepted ? acceptedTimes : rejectedTimes)[index]));
    await expect(best.locator("small")).toHaveText(today);
    const trials = assessments.filter({ hasText: label });
    await expect(trials).toHaveCount(accepted ? 2 : 1);
    for (const times of accepted ? [rejectedTimes, acceptedTimes] : [rejectedTimes]) {
      const trial = trials.filter({ has: page.getByText(formatSwimTime(times[index]), { exact: true }) });
      await expect(trial).toHaveCount(1);
      await expect(trial.locator("small")).toHaveText(today);
    }
  }
  const manage = page.getByRole("heading", { name: "Manage plan", exact: true }).locator("..");
  const past = manage.locator("details").filter({ has: page.getByText("Past decisions", { exact: true }) });
  await openDisclosure(past);
  await expect(past.getByRole("listitem")).toHaveCount(accepted ? 2 : 1);
  await expect(past.getByText("Rejected", { exact: true })).toHaveCount(1);
  await expect(past.getByText("Accepted", { exact: true })).toHaveCount(accepted ? 1 : 0);
  const summary = page.getByRole("heading", { name: "Technique & base", exact: true }).locator("..");
  if (accepted) {
    await expect(summary.getByText(`200 / 400 yard estimate · ${formatSwimTime(acceptedPace)} / 100 yd`, { exact: true })).toBeVisible();
  } else {
    await expect(summary.getByText(/\/ 100 yd/)).toHaveCount(0);
  }
}

test("DC-SW2/DC-SW5/DC-SW6/DC-SW8: rejected native trials persist before acceptance updates only future unstarted swims", async ({
  page, context, freshUser, seedConfig, admin, baseURL,
}) => {
  await markOnboarded(admin, freshUser.userId);
  const profile = await admin.from("profiles").update({ timezone: "UTC" }).eq("id", freshUser.userId)
    .select("id,timezone").single();
  expect(profile.error === null).toBe(true);
  expect(profile.data).toEqual({ id: freshUser.userId, timezone: "UTC" });
  await signInAs(context, freshUser, seedConfig, baseURL!);
  await page.goto("/app/swim/setup");
  const serverToday = await page.getByLabel("Start date", { exact: true }).inputValue();
  expect(serverToday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
  await page.getByRole("combobox", { name: "Swimming experience", exact: true }).selectOption("regular");
  await page.getByLabel("Recent comfortable continuous lengths", { exact: true }).fill("16");
  await page.getByLabel("Minutes per swim", { exact: true }).fill("30");
  await page.getByLabel("Weeks", { exact: true }).fill("2");
  for (const day of ["Mon", "Thu"]) await expect(page.getByRole("checkbox", { name: day, exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/swim\?plan=[^&]+$/);
  const planURL = page.url();
  const created = await savedState(admin, freshUser.userId);
  expect(created.plan.id).toBe(new URL(planURL).searchParams.get("plan"));
  expect(created.plan.definition).toMatchObject({
    setup: { course, equipment: [], knownStrokes: ["freestyle"], recentComfortableLengths: 16, sessionBudgetMinutes: 30 },
    schedule: { startDate: serverToday, weeks: 2, weekdays: [1, 4] },
  });
  expect(created.plan.state.observations).toEqual([]);
  expect(created.plan.state.acceptedCalibration).toBeNull();
  expect(created.plan.state.decisions).toHaveLength(1);
  expect(created.plan.state.decisions[0].kind).toBe("setup");
  for (const row of created.workouts) {
    expect(row.status).toBe("scheduled");
    expect(row.session_id).toBeNull();
    expect(row.definition.original).toEqual(row.definition.issued);
    expect(row.definition.modifications).toEqual([]);
    expect(row.definition.issued.snapshot.calibration).toBeNull();
    const items = row.definition.issued.sections.flatMap((section) => section.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.stroke).toBe("freestyle");
      expect(item.equipment).toEqual([]);
      expect(item.targetMsPerRepeat).toBeUndefined();
    }
  }
  const future = created.workouts.filter((row) => row.scheduled_date > serverToday && row.status === "scheduled" && row.session_id === null);
  expect(future.length).toBeGreaterThan(1);
  const owner = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await owner.auth.signInWithPassword({ email: freshUser.email, password: freshUser.password });
  expect(signedIn.error === null).toBe(true);
  expect(signedIn.data.user?.id).toBe(freshUser.userId);
  const started = await startSwimWorkout(owner, future[0].id, future[0].revision);
  expect(started.id).toBe(future[0].id);
  expect(started.user_id).toBe(freshUser.userId);
  expect(started.status).toBe("started");
  expect(started.session_id).toEqual(expect.any(String));
  expect(started.session_id?.length).toBeGreaterThan(0);
  const original = await savedState(admin, freshUser.userId);
  expect(original.workouts.filter((row) => row.status === "started")).toEqual([started]);
  expect(original.workouts.filter((row) => row.session_id !== null)).toEqual([started]);
  for (const row of original.workouts) {
    const prior = created.workouts.find((entry) => entry.id === row.id)!;
    expect(row.definition).toEqual(prior.definition);
    if (row.id !== started.id) expect(row).toEqual(prior);
  }
  const eligibleIds = original.workouts.filter((row) =>
    row.scheduled_date > serverToday && row.status === "scheduled" && row.session_id === null,
  ).map((row) => row.id).sort();
  expect(eligibleIds.length).toBeGreaterThan(0);

  await page.goto(planURL);
  const first = await reviewAssessment(page, serverToday, rejectedTimes);
  expect(await savedState(admin, freshUser.userId)).toEqual(original);
  await first.getByRole("button", { name: "Reject assessment", exact: true }).click();
  await expect(first.getByRole("button", { name: "Reject assessment", exact: true })).toHaveCount(0);
  const rejected = await savedState(admin, freshUser.userId);
  const rejectedDecision = assertDecision(original, rejected, observation(serverToday, rejectedTimes), "rejected");
  expect(rejected.plan.state.acceptedCalibration).toBeNull();
  expect(rejected.workouts).toEqual(original.workouts);
  await assertHistory(page, serverToday, false);
  await page.reload();
  expect(await savedState(admin, freshUser.userId)).toEqual(rejected);
  await assertHistory(page, serverToday, false);

  const second = await reviewAssessment(page, serverToday, acceptedTimes);
  expect(await savedState(admin, freshUser.userId)).toEqual(rejected);
  await second.getByRole("button", { name: "Accept assessment", exact: true }).click();
  await expect(second.getByRole("button", { name: "Accept assessment", exact: true })).toHaveCount(0);
  const accepted = await savedState(admin, freshUser.userId);
  const acceptedObservation = observation(serverToday, acceptedTimes);
  const acceptedDecision = assertDecision(rejected, accepted, acceptedObservation, "accepted");
  expect(acceptedDecision.id).not.toBe(rejectedDecision.id);
  expect(accepted.plan.state.decisions.filter((entry) => entry.kind === "assessment").map((entry) => entry.decision))
    .toEqual(["rejected", "accepted"]);
  expect(accepted.plan.state.observations).toEqual([observation(serverToday, rejectedTimes), acceptedObservation]);
  expect(accepted.plan.state.acceptedCalibration).toMatchObject({
    msPer100: acceptedPace, unit: "yd", course, stroke: "freestyle", equipment: [],
    observation: acceptedObservation, version: SWIM_ASSESSMENT_VERSION,
  });
  expect(accepted.workouts.map((row) => row.id)).toEqual(original.workouts.map((row) => row.id));
  const changedIds = accepted.workouts.filter((row) =>
    JSON.stringify(row) !== JSON.stringify(rejected.workouts.find((prior) => prior.id === row.id)),
  ).map((row) => row.id).sort();
  expect(changedIds).toEqual(eligibleIds);
  for (const row of accepted.workouts) {
    const prior = rejected.workouts.find((entry) => entry.id === row.id)!;
    const initial = original.workouts.find((entry) => entry.id === row.id)!;
    expect(row.definition.original).toEqual(initial.definition.original);
    if (!eligibleIds.includes(row.id)) {
      expect(row).toEqual(initial);
      continue;
    }
    const modifications = row.definition.modifications;
    expect(modifications).toHaveLength(prior.definition.modifications.length + 1);
    expect(modifications.slice(0, -1)).toEqual(prior.definition.modifications);
    expect(modifications[modifications.length - 1]).toMatchObject({
      decisionId: acceptedDecision.id, previous: prior.definition.issued,
    });
    expect(modifications[modifications.length - 1].id.length).toBeGreaterThan(0);
    const issued = row.definition.issued;
    expect(issued).not.toEqual(prior.definition.issued);
    expect(issued).toEqual({
      ...prior.definition.issued,
      sections: prior.definition.issued.sections.map((section) => ({
        ...section, items: section.items.map((item) => ({
          ...item, targetMsPerRepeat: Math.round(acceptedPace * SWIM_EFFORT_PACE_FACTORS[item.effort] * item.lengths * 25 / 100),
        })),
      })),
      snapshot: {
        ...prior.definition.issued.snapshot, protocol: "css_200_400",
        versions: { ...prior.definition.issued.snapshot.versions, assessment: SWIM_ASSESSMENT_VERSION },
        calibration: {
          msPer100: acceptedPace, unit: "yd", protocol: "css_200_400", observedOn: serverToday,
          heuristic: true, version: SWIM_ASSESSMENT_VERSION, observation: acceptedObservation,
        },
      },
    });
    expect(row).toEqual({
      ...prior, revision: prior.revision + 1, updated_at: row.updated_at,
      definition: { ...prior.definition, issued, modifications },
    });
  }
  await assertHistory(page, serverToday, true);
  await page.reload();
  expect(await savedState(admin, freshUser.userId)).toEqual(accepted);
  await assertHistory(page, serverToday, true);
});
