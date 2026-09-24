import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Locator, Page, Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applySwimProposal, generateSwimPlan, recordSwimDecision, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { estimateCriticalSwimSpeed, swimWorkoutLengths, validateSwimWorkout, type SwimSetup } from "@hta/domain";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedSwimPrimaryBaseline } from "./fixtures/swim-primary";
import type { SwimResumePreview } from "../src/lib/swim/view-types";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd, isoWeekdayYmd } from "../src/lib/dates";
import {
  standaloneWeekRequests, swimPlanDefinition, swimWorkoutDefinition, SWIM_SCHEDULE_VERSION,
  type StandalonePlanDefinition, type StandaloneWorkoutDefinition,
} from "../src/lib/swim/model";
import { deriveSwimWeekCandidate, loadSwimHistory, persistedSwimPlan } from "../src/lib/swim/queries";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout, listSwimPlans, listSwimWorkouts,
  type SwimWorkoutInput,
} from "../src/lib/swim/storage";
import { parseSetupForm } from "../src/lib/swim/forms";
import { completeRetainedSwim } from "./fixtures/swim-retained";
import { openSwimProgramActions } from "./fixtures/swim-navigation";
import { loadTrainingSchedule } from "../src/lib/schedule/storage";
const test = seededTest.extend<{ actor: SupabaseClient }>({
  seedConfig: async ({ baseURL }, use) => {
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1" ||
      process.env.POOL_SWIMMING_ENABLED !== "true") {
      throw new Error("B cases require explicitly enabled disposable local swimming.");
    }
    if (!baseURL || !URL.canParse(baseURL) || process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
      throw new Error("B cases require an explicit loopback HTTP baseURL.");
    }
    const url = new URL(baseURL);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("B cases require an explicit loopback HTTP baseURL.");
    }
    const { E2E_SUPABASE_URL: supabaseUrl, E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Missing dedicated seed configuration.");
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
  actor: async ({ admin, freshUser, seedConfig }, use) => {
    try {
      await markOnboarded(admin, freshUser.userId);
      const profile = await admin.from("profiles").update({ timezone: "UTC" })
        .eq("id", freshUser.userId).select("id,timezone").single();
      expect(profile.error).toBeNull();
      expect(profile.data?.timezone).toBe("UTC");
      const client = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signedIn = await client.auth.signInWithPassword(freshUser);
      expect(signedIn.error).toBeNull();
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callback.
      await use(client);
    } finally {
      const deleted = await admin.auth.admin.deleteUser(freshUser.userId);
      expect(deleted.error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(freshUser.userId);
      expect(remaining.data.user).toBeNull();
      expect(remaining.error?.status).toBe(404);
    }
  },
});

// Keep private fixture values out of assertion diagnostics.
function same(actual: unknown, expected: unknown) {
  expect(isDeepStrictEqual(actual, expected), "Private fixture comparison").toBe(true);
}

async function saved(client: SupabaseClient, planId: string) {
  const plans = await listSwimPlans(client);
  expect(plans).toHaveLength(1);
  const plan = plans.find((row) => row.id === planId);
  if (!plan) throw new Error("Missing synthetic plan.");
  const workouts = await listSwimWorkouts(client, planId);
  expect(workouts).toHaveLength(6);
  return { plan, workouts, history: await loadSwimHistory(client, workouts) };
}

async function arrangePlan(client: SupabaseClient, today: string) {
  // Rolling weeks put source slots at -5/-2 and the target at +2/+5 on every weekday.
  const startDate = addDaysToYmd(today, -5);
  const weekdays = [(isoWeekdayYmd(startDate) + 1) % 7, (isoWeekdayYmd(addDaysToYmd(startDate, 3)) + 1) % 7];
  const setup: SwimSetup = {
    goal: "technique_base", experience: "recreational",
    course: { numerator: 25, denominator: 1, unit: "yd" }, knownStrokes: ["freestyle"],
    equipment: [], recentComfortableLengths: 12, sessionBudgetMinutes: 60,
  };
  const generated = generateSwimPlan({ setup, calibration: null, weeks: standaloneWeekRequests(startDate, 3, weekdays) });
  if (!generated.ok) throw new Error("Canonical swim generation failed.");
  const definition: StandalonePlanDefinition = {
    version: 1, setup, generatorVersion: SWIM_GENERATOR_VERSION,
    schedule: { startDate, weeks: 3, weekdays }, initialDose: generated.value.dose,
  };
  const workouts: SwimWorkoutInput[] = generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
    if (slot.kind !== "workout") throw new Error("Expected canonical swim workout.");
    const definition: StandaloneWorkoutDefinition = {
      version: 1, original: slot.original, issued: slot.issued, modifications: [],
      weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
    };
    return { scheduled_date: slot.dateISO, slot: "single", definition };
  }));
  same(workouts.map((row) => row.scheduled_date), [-5, -2, 2, 5, 9, 12].map((offset) => addDaysToYmd(today, offset)));
  return createSwimPlan(client, {
    startedOn: startDate, endsOn: addDaysToYmd(startDate, 20), definition,
    state: { version: 1, observations: [], acceptedCalibration: null, decisions: [] }, workouts,
  });
}

async function observeCompletionRows(client: SupabaseClient, userId: string, workoutId: string, sessionId: string) {
  const [workout, session, logs] = await Promise.all([
    client.from("swim_workouts").select("*").eq("user_id", userId).eq("id", workoutId).single(),
    client.from("sessions").select("id,user_id,completed_at,completion_outbox_entry_id,duration_min,session_rpe,notes")
      .eq("user_id", userId).eq("id", sessionId).single(),
    client.from("cardio_logs").select("id,session_id,client_log_id,swim_result,duration_sec,distance_km,rpe,notes")
      .eq("session_id", sessionId).order("id"),
  ]);
  if (workout.error || session.error || logs.error) throw new Error("Synthetic completion observation failed.");
  return { workout, session, logs };
}

function assertCompletionRows(
  { workout, session, logs }: Awaited<ReturnType<typeof observeCompletionRows>>, sessionId: string,
) {
  expect(!workout.error && !session.error && !logs.error, "Synthetic completion rows readable").toBe(true);
  if (!workout.data || !session.data || !logs.data) throw new Error("Missing synthetic completion rows.");
  same(workout.data.session_id, sessionId);
  return { workout: workout.data, session: session.data, logs: logs.data };
}

async function completionRows(client: SupabaseClient, userId: string, workoutId: string, sessionId: string) {
  return assertCompletionRows(await observeCompletionRows(client, userId, workoutId, sessionId), sessionId);
}

async function budgetSetup(page: Page, times?: readonly [string, string]) {
  await page.goto("/app/swim/setup");
  const form = page.locator("form").filter({ has: page.getByRole("combobox", { name: "Pool length", exact: true }) });
  await expect(form).toHaveCount(1);
  await form.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
  await form.getByRole("combobox", { name: "Goal", exact: true }).selectOption("endurance");
  await form.getByRole("combobox", { name: "Experience", exact: true }).selectOption(times ? "regular" : "beginner");
  await form.getByLabel("Recent comfortable non-stop lengths", { exact: true }).fill(times ? "12" : "0");
  for (const group of ["Known strokes", "Equipment", "Swim days"]) {
    for (const control of await form.getByRole("group", { name: group, exact: true }).getByRole("checkbox").all()) {
      await control.uncheck();
    }
  }
  if (times) await form.getByRole("checkbox", { name: "Freestyle", exact: true }).check();
  await form.getByRole("checkbox", { name: "Mon", exact: true }).check();
  await form.getByLabel("Minutes per swim", { exact: true }).fill("10");
  await form.getByLabel("Weeks", { exact: true }).fill("2");
  const today = await form.getByLabel("Start date", { exact: true }).inputValue();
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  if (times) {
    await form.getByText("200 / 400 assessment (optional)", { exact: true }).click();
    await form.getByLabel("200 time · min:sec", { exact: true }).fill(times[0]);
    await form.getByLabel("400 time · min:sec", { exact: true }).fill(times[1]);
    await form.getByLabel("Swum on", { exact: true }).fill(today);
    await form.getByRole("combobox", { name: "Assessment stroke", exact: true }).selectOption("freestyle");
    await form.getByRole("checkbox", { name: "Verified times, same pool and stroke, without equipment", exact: true }).check();
  }
  return form;
}

async function setupPreview(form: Locator) {
  const entries = await form.evaluate((node) =>
    [...new FormData(node as HTMLFormElement)].map(([key, value]) => [key, String(value)] as const));
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  const input = parseSetupForm(data);
  const assessed = input.observation ? estimateCriticalSwimSpeed(input.observation) : null;
  if (assessed && !assessed.ok) throw new Error("Synthetic assessment must be supported.");
  const calibration = assessed?.ok ? assessed.value : null;
  const generated = generateSwimPlan({
    setup: input.setup, calibration,
    weeks: standaloneWeekRequests(input.startDate, input.weeks, input.weekdays),
  });
  if (!generated.ok) throw new Error("Synthetic setup must be supported.");
  return { entries, input, calibration, generated: generated.value };
}

async function setupRows(client: SupabaseClient, userId: string) {
  const [plans, workouts, sessions] = await Promise.all([
    listSwimPlans(client), listSwimWorkouts(client),
    client.from("sessions").select("id").eq("user_id", userId),
  ]);
  expect(plans.every((row) => row.user_id === userId)).toBe(true);
  expect(workouts.every((row) => row.user_id === userId)).toBe(true);
  expect(sessions.error === null).toBe(true);
  expect(sessions.data).toHaveLength(0);
  return { plans, workouts };
}

function assertSetupWorkouts(
  rows: Awaited<ReturnType<typeof setupRows>>, preview: Awaited<ReturnType<typeof setupPreview>>, minutes: number,
) {
  expect(rows.plans).toHaveLength(1);
  const plan = rows.plans[0];
  const definition = swimPlanDefinition(plan);
  expect(isDeepStrictEqual(definition.setup, preview.input.setup)).toBe(true);
  expect(isDeepStrictEqual(definition.schedule, {
    startDate: preview.input.startDate, weeks: preview.input.weeks, weekdays: preview.input.weekdays,
  })).toBe(true);
  expect(isDeepStrictEqual(plan.state.observations, [preview.input.observation])).toBe(true);
  expect(isDeepStrictEqual(plan.state.acceptedCalibration, preview.calibration)).toBe(true);
  expect(plan.state.decisions).toHaveLength(1);
  const audit = plan.state.decisions[0];
  expect(audit.kind).toBe("setup");
  expect(audit.decision).toBe("accepted");
  expect(isDeepStrictEqual(audit.inputSnapshot, {
    ...preview.input, versions: preview.generated.versions,
  })).toBe(true);
  const generated = generateSwimPlan({
    setup: definition.setup, calibration: plan.state.acceptedCalibration,
    weeks: standaloneWeekRequests(definition.schedule.startDate, definition.schedule.weeks, definition.schedule.weekdays),
  });
  if (!generated.ok) throw new Error("Stored setup must generate.");
  expect(isDeepStrictEqual(generated.value, preview.generated)).toBe(true);
  expect(isDeepStrictEqual(definition, {
    version: 1, setup: preview.input.setup, generatorVersion: SWIM_GENERATOR_VERSION,
    schedule: { startDate: preview.input.startDate, weeks: preview.input.weeks, weekdays: preview.input.weekdays },
    initialDose: generated.value.dose,
  })).toBe(true);
  const expected = generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
    if (slot.kind !== "workout") throw new Error("Expected a whole-length workout.");
    return {
      scheduled_date: slot.dateISO, slot: "single",
      definition: {
        version: 1, original: slot.original, issued: slot.issued, modifications: [],
        weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
      },
    };
  }));
  expect(expected).toHaveLength(2);
  expect(isDeepStrictEqual(rows.workouts.map(({ scheduled_date, slot, definition }) =>
    ({ scheduled_date, slot, definition })), expected)).toBe(true);
  for (const row of rows.workouts) {
    expect(isDeepStrictEqual(row.plan_id, plan.id)).toBe(true);
    expect(row.status).toBe("scheduled");
    expect(row.session_id).toBeNull();
    const workout = row.definition.issued;
    expect(isDeepStrictEqual(workout.snapshot.course, { numerator: 50, denominator: 1, unit: "m" })).toBe(true);
    expect(isDeepStrictEqual(workout.snapshot.strokes, ["freestyle"])).toBe(true);
    expect(workout.snapshot.equipment).toHaveLength(0);
    expect(validateSwimWorkout(workout).length).toBe(0);
    expect(workout.totalLengths).toBe(swimWorkoutLengths(workout));
    expect(workout.focus).toBe("endurance");
    expect(workout.budget.minutes).toBe(minutes);
    expect(Number.isInteger(workout.budget.accountedMs)).toBe(true);
    expect(workout.budget.accountedMs).toBeGreaterThan(0);
    expect(workout.budget.accountedMs).toBeLessThanOrEqual(minutes * 60_000);
    expect(workout.estimatedMs).toBe(workout.budget.accountedMs);
    expect(workout.sections[0].kind).toBe("warmup");
    expect(workout.sections.at(-1)?.kind).toBe("cooldown");
    for (const kind of ["warmup", "main", "cooldown"]) {
      const section = workout.sections.find((item) => item.kind === kind);
      expect(!!section && section.items.length > 0).toBe(true);
      expect(section?.items.every((item) => item.effort === (kind === "main" ? "steady" : "easy"))).toBe(true);
    }
    for (const section of workout.sections) {
      expect(Number.isInteger(section.rounds) && section.rounds > 0).toBe(true);
      for (const item of section.items) {
        expect(Number.isInteger(item.lengths) && item.lengths > 0).toBe(true);
        expect(Number.isInteger(item.repeats) && item.repeats > 0).toBe(true);
        expect(item.equipment).toHaveLength(0);
        expect(item.stroke).toBe("freestyle");
      }
    }
  }
}

test.describe("ADR0079 later-cohort B swimming decisions and retained results", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });
  test.skip(!swimE2EEnabled(process.env), "Blocked: swimming E2E was not explicitly requested.");

  test("B1 DC-SW4/DC-SW5: settled history advances only the unstarted next-week target once", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    const today = await page.getByLabel("Start date", { exact: true }).inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const created = await arrangePlan(actor, today);
    const initial = await saved(actor, created.plan.id);
    for (const workout of initial.workouts.slice(0, 2)) {
      expect(workout.scheduled_date < today).toBe(true);
      const started = await startSwimWorkout(actor, workout.id, workout.revision);
      await completeSwimWorkout(actor, {
        workoutId: started.id, expectedRevision: started.revision,
        clientLogId: randomUUID(), completionEntryId: randomUUID(),
        result: {
          version: 1, snapshot: started.definition.issued.snapshot,
          lengths: started.definition.issued.totalLengths, timeMs: 1200000, rpe: 5,
          completion: "completed", provenance: { source: "manual", recordedAt: new Date().toISOString() },
        },
      });
    }
    const startedTarget = initial.workouts[2];
    expect(initial.workouts.slice(2).every((row) => row.scheduled_date > today)).toBe(true);
    await startSwimWorkout(actor, startedTarget.id, startedTarget.revision);
    const before = await saved(actor, created.plan.id);
    expect(before.history.slice(0, 2).every((row) =>
      row.workout.status === "completed" && !!row.completedAt && row.result?.rpe === 5 &&
      row.result.lengths === row.workout.definition.issued.totalLengths && !row.deleted && !row.sourceGone,
    )).toBe(true);
    const candidate = deriveSwimWeekCandidate(before.plan, before.history, today);
    if (!candidate) throw new Error("Expected improving candidate.");
    expect(candidate.proposal.decision).toBe("progress");
    expect(candidate.sourceWeek).toBe(0);
    expect(candidate.targetWeek).toBe(1);
    same(candidate.targetWorkoutIds, before.workouts.slice(2, 4).map((row) => row.id));
    same(candidate.proposal.from, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 });
    same(candidate.proposal.to, { mainRepeats: 13, mainRepLengths: 2, mainRestSeconds: 25 });
    expect(candidate.proposal.lever).toBe("main_repeats");
    expect(candidate.proposal.snapshot.capLengths).toBeGreaterThanOrEqual(2);

    await page.goto(`/app/swim?plan=${created.plan.id}`);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    const proposal = page.getByRole("heading", { name: "Progress · Week 2", exact: true }).locator("..");
    await expect(proposal).toBeVisible();
    await proposal.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    const after = await saved(actor, created.plan.id);
    expect(after.plan.revision).toBe(before.plan.revision + 1);
    expect(after.plan.state.decisions).toHaveLength(1);
    const audit = after.plan.state.decisions[0];
    same({ id: audit.id, kind: audit.kind, decision: audit.decision,
      ruleVersion: audit.ruleVersion, generatorVersion: audit.generatorVersion }, {
      id: candidate.id, kind: "progression", decision: "accepted",
      ruleVersion: SWIM_GENERATOR_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
    });
    const engineDecision = audit.inputSnapshot.engineDecision;
    if (!engineDecision || typeof engineDecision !== "object" ||
      !("atISO" in engineDecision) || typeof engineDecision.atISO !== "string") {
      throw new Error("Missing persisted engine decision timestamp.");
    }
    expect(Number.isFinite(Date.parse(engineDecision.atISO))).toBe(true);
    const ledger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: "accept", atISO: engineDecision.atISO,
    });
    same(audit.inputSnapshot, JSON.parse(JSON.stringify({
      ...candidate.exactInputs, proposal: candidate.proposal,
      engineDecision: ledger.entries[0], appliedDose: candidate.proposal.to,
    })));
    expect(Number.isFinite(Date.parse(audit.recordedAt))).toBe(true);
    for (const [index, row] of after.workouts.entries()) {
      const prior = before.workouts[index];
      same([row.id, row.scheduled_date, row.slot, row.definition.original],
        [prior.id, prior.scheduled_date, prior.slot, prior.definition.original]);
      expect(row.definition.issued.budget?.minutes).toBe(prior.definition.issued.budget?.minutes);
      if (index !== 3) {
        same(row, prior);
        continue;
      }
      const expected = candidate.generated.weeks[1].slots.find((slot) => slot.slotId === swimWorkoutDefinition(row).slotId);
      if (!expected || expected.kind !== "workout") throw new Error("Missing expected target.");
      same(row.definition.issued, expected.issued);
      expect(row.revision).toBe(prior.revision + 1);
      expect(swimWorkoutDefinition(row).provisional).toBe(false);
      expect(prior.definition.issued.totalLengths).toBe(35);
      expect(row.definition.issued.totalLengths).toBe(37);
      expect(row.definition.modifications).toHaveLength(1);
      same(row.definition.modifications[0].previous, prior.definition.issued);
      same(row.definition.modifications[0].decisionId, audit.id);
    }
    same(after.plan.definition, before.plan.definition);
    expect(deriveSwimWeekCandidate(after.plan, after.history, today)).toBeNull();
    await page.reload();
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review next week", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    await page.getByText("Past decisions", { exact: true }).click();
    await expect(page.getByText("Accepted", { exact: true })).toHaveCount(1);
    same(await saved(actor, created.plan.id), after);
  });

  test("B2 DC-SW8: retained completions survive tab reloads and skipping another workout", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
    await page.getByLabel("Recent comfortable non-stop lengths", { exact: true }).fill("12");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Preview plan", exact: true }).click();
    await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=[^&]+$/);
    const plans = await listSwimPlans(actor);
    expect(plans).toHaveLength(1);
    const workouts = await listSwimWorkouts(actor, plans[0].id);
    expect(workouts).toHaveLength(4);
    const completions = [];
    for (const [index, workout] of workouts.slice(0, 2).entries()) {
      const completed = await completeRetainedSwim(actor, workout, { timeMs: (20 + index) * 60000, rpe: 5 });
      const rows = await completionRows(actor, freshUser.userId, workout.id, completed.session_id);
      expect(rows.workout.status).toBe("completed");
      expect(typeof rows.session.completed_at).toBe("string");
      expect(rows.logs).toHaveLength(1);
      const log = rows.logs[0];
      same([log.client_log_id, log.session_id], [rows.session.completion_outbox_entry_id, completed.session_id]);
      same(log.swim_result.snapshot, workout.definition.issued.snapshot);
      same([log.swim_result.lengths, log.swim_result.timeMs, log.swim_result.rpe, log.swim_result.completion],
        [workout.definition.issued.totalLengths, (20 + index) * 60000, 5, "completed"]);
      same([log.duration_sec, rows.session.duration_min, Number(rows.session.session_rpe)],
        [(20 + index) * 60, 20 + index, 5]);
      completions.push(rows);
    }
    expect(new Set(completions.map((row) => row.session.id)).size).toBe(2);
    expect(new Set(completions.map((row) => row.logs[0].client_log_id)).size).toBe(2);
    const second = await context.newPage();
    try {
      for (const [index, tab] of [page, second].entries()) {
        await tab.goto(`/app/swim/${workouts[index].id}`);
        const result = tab.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
        await expect(result).toContainText(`${workouts[index].definition.issued.totalLengths} lengths`);
        await expect(result).toContainText(index === 0 ? "20:00" : "21:00");
        await expect(result).toContainText("RPE 5");
        await tab.reload();
        await expect(result).toContainText(index === 0 ? "20:00" : "21:00");
      }
      const beforeSkip = await saved(actor, plans[0].id);
      await page.goto(`/app/swim/${workouts[2].id}`);
      await page.locator("summary").filter({ hasText: /^Skip swim$/ }).click();
      await page.getByLabel("Reason", { exact: true }).fill("Synthetic explicit skip");
      await page.getByRole("button", { name: "Skip swim", exact: true }).click();
      await expect(page.locator("main > section").first().getByText("Skipped", { exact: true })).toBeVisible();
      const after = await listSwimWorkouts(actor, plans[0].id);
      same(after[2], {
        ...workouts[2], status: "skipped", revision: workouts[2].revision + 1, updated_at: after[2].updated_at,
        definition: { ...workouts[2].definition, skip: { recordedAt: after[2].definition.skip?.recordedAt, reason: "Synthetic explicit skip" } },
      });
      expect(Number.isFinite(Date.parse(after[2].definition.skip!.recordedAt))).toBe(true);
      same(after[3], workouts[3]);
      const afterSkip = await saved(actor, plans[0].id);
      same(afterSkip.plan, {
        ...beforeSkip.plan, revision: beforeSkip.plan.revision + 1, updated_at: afterSkip.plan.updated_at,
      });
      same(afterSkip.workouts, after);
      for (const [index, saved] of completions.entries()) {
        same(await completionRows(actor, freshUser.userId, workouts[index].id, saved.session.id), saved);
      }
    } finally { await second.close(); }
  });

  test("B3 DC-SW4/DC-SW5: plateau rejection preserves issued work and decision history", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    const today = await page.getByLabel("Start date", { exact: true }).inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const created = await arrangePlan(actor, today);
    const initial = await saved(actor, created.plan.id);
    for (const workout of initial.workouts.slice(0, 2)) {
      expect(workout.scheduled_date < today).toBe(true);
      const started = await startSwimWorkout(actor, workout.id, workout.revision);
      await completeSwimWorkout(actor, {
        workoutId: started.id, expectedRevision: started.revision,
        clientLogId: randomUUID(), completionEntryId: randomUUID(),
        result: {
          version: 1, snapshot: started.definition.issued.snapshot,
          lengths: started.definition.issued.totalLengths, timeMs: 1200000, rpe: 7,
          completion: "completed", provenance: { source: "manual", recordedAt: new Date().toISOString() },
        },
      });
    }
    const before = await saved(actor, created.plan.id);
    expect(before.history.slice(0, 2).every((row) =>
      row.workout.status === "completed" && !!row.completedAt && row.result?.rpe === 7 &&
      row.result.lengths === row.workout.definition.issued.totalLengths && !row.deleted && !row.sourceGone,
    )).toBe(true);
    const candidate = deriveSwimWeekCandidate(before.plan, before.history, today);
    if (!candidate) throw new Error("Expected plateau candidate.");
    expect(candidate.proposal.decision).toBe("hold");
    expect(candidate.proposal.lever).toBe("none");
    same(candidate.proposal.from, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 });
    same(candidate.proposal.to, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 });
    same(candidate.proposal.reasons, ["completed_as_prescribed"]);
    expect(candidate.proposal.snapshot.completionRatio).toBe(1);
    expect(candidate.proposal.snapshot.meanRpe).toBe(7);
    expect(candidate.proposal.snapshot.rpeMissing).toBe(0);
    same([candidate.sourceWeek, candidate.targetWeek], [0, 1]);
    same(candidate.targetWorkoutIds, before.workouts.slice(2, 4).map((row) => row.id));
    for (const row of before.workouts) {
      const expected = candidate.generated.weeks.flatMap((week) => week.slots)
        .find((slot) => slot.slotId === swimWorkoutDefinition(row).slotId);
      if (!expected || expected.kind !== "workout") throw new Error("Missing canonical hold target.");
      same(expected.issued, row.definition.issued);
    }

    await page.goto(`/app/swim?plan=${created.plan.id}`);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    const proposal = page.getByRole("heading", { name: "Hold · Week 2", exact: true }).locator("..");
    await expect(proposal).toBeVisible();
    await proposal.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    const after = await saved(actor, created.plan.id);
    expect(after.plan.revision).toBe(before.plan.revision + 1);
    expect(after.plan.state.decisions).toHaveLength(1);
    const audit = after.plan.state.decisions[0];
    same({ id: audit.id, kind: audit.kind, decision: audit.decision,
      ruleVersion: audit.ruleVersion, generatorVersion: audit.generatorVersion }, {
      id: candidate.id, kind: "progression", decision: "rejected",
      ruleVersion: SWIM_GENERATOR_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
    });
    const engineDecision = audit.inputSnapshot.engineDecision;
    if (!engineDecision || typeof engineDecision !== "object" ||
      !("atISO" in engineDecision) || typeof engineDecision.atISO !== "string") {
      throw new Error("Missing persisted engine decision timestamp.");
    }
    expect(Number.isFinite(Date.parse(engineDecision.atISO))).toBe(true);
    const ledger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: "reject", atISO: engineDecision.atISO,
    });
    same(audit.inputSnapshot, JSON.parse(JSON.stringify({
      ...candidate.exactInputs, proposal: candidate.proposal,
      engineDecision: ledger.entries[0], appliedDose: { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 },
    })));
    expect(Number.isFinite(Date.parse(audit.recordedAt))).toBe(true);
    same(after.plan, { ...before.plan, revision: before.plan.revision + 1, updated_at: after.plan.updated_at,
      state: { ...before.plan.state, decisions: [audit] } });
    same(after.workouts, before.workouts);
    same(after.history, before.history);
    same(after.workouts.map((row) => row.definition), initial.workouts.map((row) => row.definition));
    expect(deriveSwimWeekCandidate(after.plan, after.history, today)).toBeNull();
    await page.reload();
    await page.getByText("Past decisions", { exact: true }).click();
    await expect(page.getByText("Rejected", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review next week", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    same(await saved(actor, created.plan.id), after);
  });

  test("B4 DC-SW4/DC-SW5/DC-K4: missed high-effort work supports a recorded warning override without catch-up", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    const today = await page.getByLabel("Start date", { exact: true }).inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const created = await arrangePlan(actor, today);
    const initial = await saved(actor, created.plan.id);
    expect(initial.workouts.slice(0, 2).every((row) => row.scheduled_date < today)).toBe(true);
    const missed = initial.workouts[0];
    const skipReason = "No pool access.";
    await page.goto(`/app/swim/${missed.id}`);
    await page.locator("summary").filter({ hasText: /^Skip swim$/ }).click();
    await page.getByLabel("Reason", { exact: true }).fill(skipReason);
    await page.getByRole("button", { name: "Skip swim", exact: true }).click();
    await expect(page.getByRole("button", { name: "Skip swim", exact: true })).toHaveCount(0);
    const source = initial.workouts[1];
    const started = await startSwimWorkout(actor, source.id, source.revision);
    expect(started.definition.issued.totalLengths).toBe(35);
    await completeSwimWorkout(actor, {
      workoutId: started.id, expectedRevision: started.revision,
      clientLogId: randomUUID(), completionEntryId: randomUUID(),
      result: {
        version: 1, snapshot: started.definition.issued.snapshot,
        lengths: 18, timeMs: 1200000, rpe: 9,
        completion: "partial", provenance: { source: "manual", recordedAt: new Date().toISOString() },
      },
    });
    const startedTarget = initial.workouts[2];
    await startSwimWorkout(actor, startedTarget.id, startedTarget.revision);
    const before = await saved(actor, created.plan.id);
    expect(before.workouts[2].status).toBe("started");
    expect(!!before.workouts[2].session_id).toBe(true);
    expect(isDeepStrictEqual(before.workouts.slice(1).map((row) => row.definition), initial.workouts.slice(1).map((row) => row.definition))).toBe(true);
    const skipped = before.workouts[0];
    expect(isDeepStrictEqual(skipped, { ...missed, status: "skipped", revision: missed.revision + 1,
      updated_at: skipped.updated_at, definition: { ...missed.definition, skip: skipped.definition.skip } })).toBe(true);
    expect(skipped.definition.skip?.reason).toBe(skipReason);
    expect(before.history[0].workout.status).toBe("skipped");
    expect(before.history[0].workout.session_id).toBeNull();
    expect(before.history[0].result).toBeNull();
    expect(before.history[0].completedAt).toBeNull();
    expect(before.history[1].workout.status).toBe("completed");
    expect(!!before.history[1].completedAt && !before.history[1].deleted && !before.history[1].sourceGone).toBe(true);
    expect(isDeepStrictEqual(before.history[1].result?.snapshot, source.definition.issued.snapshot)).toBe(true);
    const candidate = deriveSwimWeekCandidate(before.plan, before.history, today);
    if (!candidate) throw new Error("Expected missed high-effort candidate.");
    expect(candidate.proposal.decision).toBe("reduce");
    expect(candidate.proposal.lever).toBe("main_repeats");
    expect(isDeepStrictEqual(candidate.proposal.from, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 })).toBe(true);
    expect(isDeepStrictEqual(candidate.proposal.to, { mainRepeats: 11, mainRepLengths: 2, mainRestSeconds: 25 })).toBe(true);
    expect(isDeepStrictEqual(candidate.proposal.reasons, ["missed_sessions", "effort_high"])).toBe(true);
    expect(candidate.proposal.snapshot.plannedLengths).toBe(70);
    expect(candidate.proposal.snapshot.actualLengths).toBe(18);
    expect(candidate.proposal.snapshot.missedSessions).toBe(1);
    expect(candidate.proposal.snapshot.meanRpe).toBe(9);
    expect(isDeepStrictEqual(candidate.input.history.map(({ completion, actualLengths, rpe }) => ({ completion, actualLengths, rpe })), [
      { completion: "missed", actualLengths: null, rpe: null },
      { completion: "partial", actualLengths: 18, rpe: 9 },
    ])).toBe(true);
    expect(isDeepStrictEqual([candidate.sourceWeek, candidate.targetWeek], [0, 1])).toBe(true);
    expect(isDeepStrictEqual(candidate.targetWorkoutIds, before.workouts.slice(2, 4).map((row) => row.id))).toBe(true);
    // No integer lies between 11 and 12 repeats. Eight is the nearest reduction
    // exceeding the seven-length advisory cap, so it records a warning, not catch-up.
    const chosenDose = { mainRepeats: 8, mainRepLengths: 2, mainRestSeconds: 25 };
    const reason = "Choose fewer repeats this week.";
    expect(candidate.proposal.snapshot.capLengths).toBe(7);
    const previewLedger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: "override", atISO: `${today}T00:00:00.000Z`,
      override: chosenDose, note: reason,
    });
    const warning = previewLedger.entries[0].warning;
    if (typeof warning !== "string" || !warning.length) throw new Error("Expected principle warning.");
    const chosen = applySwimProposal(persistedSwimPlan(before.plan, before.workouts), chosenDose, {
      asOfISO: today,
      startedSlotIds: before.workouts.filter((row) => row.session_id || row.status !== "scheduled" ||
        !candidate.targetWorkoutIds.includes(row.id)).map((row) => swimWorkoutDefinition(row).slotId),
    });
    if (!chosen.ok) throw new Error("Expected legal canonical override.");
    expect(isDeepStrictEqual(chosen.value.dose, { mainRepeats: 8, mainRepLengths: 2, mainRestSeconds: 25 })).toBe(true);
    const expected = chosen.value.weeks[1].slots.find((slot) => slot.slotId === swimWorkoutDefinition(before.workouts[3]).slotId);
    const suggested = candidate.generated.weeks[1].slots.find((slot) => slot.slotId === swimWorkoutDefinition(before.workouts[3]).slotId);
    if (!expected || expected.kind !== "workout" || !suggested || suggested.kind !== "workout") {
      throw new Error("Missing canonical reduced targets.");
    }
    expect(suggested.issued.totalLengths).toBe(33);
    expect(expected.issued.totalLengths).toBe(27);
    expect(expected.issued.budget.accountedMs).toBeLessThan(suggested.issued.budget.accountedMs);
    expect(expected.issued.budget.accountedMs).toBeLessThan(before.workouts[3].definition.issued.budget.accountedMs);

    await page.goto(`/app/swim?plan=${created.plan.id}`);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    const proposal = page.getByRole("heading", { name: "Reduce · Week 2", exact: true }).locator("..");
    await expect(proposal).toBeVisible();
    await proposal.getByText("Adjust repeats", { exact: true }).click();
    await proposal.getByLabel("Main repeats", { exact: true }).fill("8");
    await proposal.getByLabel("Reason", { exact: true }).fill(reason);
    await proposal.getByRole("button", { name: "Save repeats", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.locator('p[role="status"]').filter({ hasText: warning })).toBeVisible();
    const after = await saved(actor, created.plan.id);
    expect(after.plan.revision).toBe(before.plan.revision + 1);
    expect(after.plan.state.decisions).toHaveLength(1);
    const audit = after.plan.state.decisions[0];
    expect(isDeepStrictEqual({ id: audit.id, kind: audit.kind, decision: audit.decision, reason: audit.reason,
      ruleVersion: audit.ruleVersion, generatorVersion: audit.generatorVersion }, {
      id: candidate.id, kind: "progression", decision: "overridden", reason,
      ruleVersion: SWIM_GENERATOR_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
    })).toBe(true);
    const engineDecision = audit.inputSnapshot.engineDecision;
    if (!engineDecision || typeof engineDecision !== "object" ||
      !("atISO" in engineDecision) || typeof engineDecision.atISO !== "string") {
      throw new Error("Missing persisted engine decision timestamp.");
    }
    expect(Number.isFinite(Date.parse(engineDecision.atISO))).toBe(true);
    const ledger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: "override", atISO: engineDecision.atISO,
      override: chosenDose, note: reason,
    });
    expect(isDeepStrictEqual(audit.inputSnapshot, JSON.parse(JSON.stringify({
      ...candidate.exactInputs, proposal: candidate.proposal,
      engineDecision: ledger.entries[0], appliedDose: chosenDose,
    })))).toBe(true);
    expect(Number.isFinite(Date.parse(audit.recordedAt))).toBe(true);
    for (const [index, row] of after.workouts.entries()) {
      const prior = before.workouts[index];
      expect(isDeepStrictEqual([row.id, row.scheduled_date, row.slot, row.definition.original],
        [prior.id, prior.scheduled_date, prior.slot, initial.workouts[index].definition.original])).toBe(true);
      expect(row.definition.issued.budget.minutes).toBe(prior.definition.issued.budget.minutes);
      if (index !== 3) { expect(isDeepStrictEqual(row, prior)).toBe(true); continue; }
      expect(isDeepStrictEqual(row.definition.issued, expected.issued)).toBe(true);
      expect(row.revision).toBe(prior.revision + 1);
      expect(swimWorkoutDefinition(row).provisional).toBe(false);
      expect(row.definition.issued.totalLengths).toBe(27);
      expect(row.definition.modifications).toHaveLength(1);
      const modification = row.definition.modifications[0];
      expect(isDeepStrictEqual([modification.previous, modification.decisionId, modification.reason],
        [prior.definition.issued, audit.id, reason])).toBe(true);
      expect(isDeepStrictEqual(row, { ...prior, revision: prior.revision + 1, updated_at: row.updated_at,
        definition: { ...prior.definition, issued: expected.issued, provisional: false, modifications: [modification] } })).toBe(true);
    }
    expect(isDeepStrictEqual(after.history.map(({ workout, ...actual }) => ({ id: workout.id, ...actual })),
      before.history.map(({ workout, ...actual }) => ({ id: workout.id, ...actual })))).toBe(true);
    expect(isDeepStrictEqual(after.plan, { ...before.plan, revision: before.plan.revision + 1, updated_at: after.plan.updated_at,
      state: { ...before.plan.state, decisions: [audit] } })).toBe(true);
    expect(deriveSwimWeekCandidate(after.plan, after.history, today)).toBeNull();
    await page.getByText("Past decisions", { exact: true }).click();
    const decisionRow = page.getByText("Overridden", { exact: true }).locator("..");
    await expect(decisionRow).toHaveCount(1);
    await expect(decisionRow.getByText(warning, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByText("Past decisions", { exact: true }).click();
    await expect(decisionRow).toHaveCount(1);
    await expect(decisionRow.getByText(warning, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review next week", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save repeats", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    expect(isDeepStrictEqual(await saved(actor, created.plan.id), after)).toBe(true);
  });

  test("B5 DC-SW4/DC-SW5: missing effort holds the next week without advancing targets", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    const today = await page.getByLabel("Start date", { exact: true }).inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const created = await arrangePlan(actor, today);
    const initial = await saved(actor, created.plan.id);
    for (const workout of initial.workouts.slice(0, 2)) {
      expect(workout.scheduled_date < today).toBe(true);
      const started = await startSwimWorkout(actor, workout.id, workout.revision);
      await completeSwimWorkout(actor, {
        workoutId: started.id, expectedRevision: started.revision,
        clientLogId: randomUUID(), completionEntryId: randomUUID(),
        result: {
          version: 1, snapshot: started.definition.issued.snapshot,
          lengths: started.definition.issued.totalLengths, timeMs: 1200000, rpe: null,
          completion: "completed", provenance: { source: "manual", recordedAt: new Date().toISOString() },
        },
      });
    }
    const startedTarget = initial.workouts[2];
    await startSwimWorkout(actor, startedTarget.id, startedTarget.revision);
    const before = await saved(actor, created.plan.id);
    expect(before.workouts[2].status).toBe("started");
    expect(!!before.workouts[2].session_id).toBe(true);
    same(before.workouts.map((row) => row.definition), initial.workouts.map((row) => row.definition));
    expect(before.history.slice(0, 2).every((row) =>
      row.workout.status === "completed" && !!row.completedAt && row.result?.rpe === null &&
      row.result.lengths === row.workout.definition.issued.totalLengths && !row.deleted && !row.sourceGone,
    )).toBe(true);
    const candidate = deriveSwimWeekCandidate(before.plan, before.history, today);
    if (!candidate) throw new Error("Expected missing-effort candidate.");
    expect(candidate.proposal.decision).toBe("hold");
    expect(candidate.proposal.lever).toBe("none");
    same(candidate.proposal.from, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 });
    same(candidate.proposal.to, { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 });
    same(candidate.proposal.reasons, ["completed_as_prescribed", "effort_not_reported"]);
    expect(candidate.proposal.snapshot.completionRatio).toBe(1);
    expect(candidate.proposal.snapshot.meanRpe).toBeNull();
    expect(candidate.proposal.snapshot.rpeReported).toBe(0);
    expect(candidate.proposal.snapshot.rpeMissing).toBe(2);
    same(candidate.input.history.map((row) => row.rpe), [null, null]);
    same([candidate.sourceWeek, candidate.targetWeek], [0, 1]);
    same(candidate.targetWorkoutIds, before.workouts.slice(2, 4).map((row) => row.id));
    const expected = candidate.generated.weeks[1].slots.find((slot) => slot.slotId === swimWorkoutDefinition(before.workouts[3]).slotId);
    if (!expected || expected.kind !== "workout") throw new Error("Missing canonical hold target.");
    expect(expected.issued.totalLengths).toBe(35);

    await page.goto(`/app/swim?plan=${created.plan.id}`);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    const proposal = page.getByRole("heading", { name: "Hold · Week 2", exact: true }).locator("..");
    await expect(proposal).toBeVisible();
    await proposal.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    const after = await saved(actor, created.plan.id);
    expect(after.plan.revision).toBe(before.plan.revision + 1);
    expect(after.plan.state.decisions).toHaveLength(1);
    const audit = after.plan.state.decisions[0];
    same({ id: audit.id, kind: audit.kind, decision: audit.decision,
      ruleVersion: audit.ruleVersion, generatorVersion: audit.generatorVersion }, {
      id: candidate.id, kind: "progression", decision: "accepted",
      ruleVersion: SWIM_GENERATOR_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
    });
    const engineDecision = audit.inputSnapshot.engineDecision;
    if (!engineDecision || typeof engineDecision !== "object" ||
      !("atISO" in engineDecision) || typeof engineDecision.atISO !== "string") {
      throw new Error("Missing persisted engine decision timestamp.");
    }
    expect(Number.isFinite(Date.parse(engineDecision.atISO))).toBe(true);
    const ledger = recordSwimDecision(null, {
      proposal: candidate.proposal, action: "accept", atISO: engineDecision.atISO,
    });
    same(audit.inputSnapshot, JSON.parse(JSON.stringify({
      ...candidate.exactInputs, proposal: candidate.proposal,
      engineDecision: ledger.entries[0], appliedDose: { mainRepeats: 12, mainRepLengths: 2, mainRestSeconds: 25 },
    })));
    expect(Number.isFinite(Date.parse(audit.recordedAt))).toBe(true);
    for (const [index, row] of after.workouts.entries()) {
      const prior = before.workouts[index];
      same([row.id, row.scheduled_date, row.slot, row.definition.original],
        [prior.id, prior.scheduled_date, prior.slot, initial.workouts[index].definition.original]);
      same(row.definition.issued.budget, prior.definition.issued.budget);
      if (index !== 3) { same(row, prior); continue; }
      same(row.definition.issued, expected.issued);
      expect(row.definition.issued.totalLengths).toBe(35);
      expect(row.revision).toBe(prior.revision + 1);
      expect(swimWorkoutDefinition(row).provisional).toBe(false);
      const changed = !isDeepStrictEqual(expected.issued, prior.definition.issued);
      expect(row.definition.modifications).toHaveLength(changed ? 1 : 0);
      if (changed) {
        same(row.definition.modifications[0].previous, prior.definition.issued);
        same(row.definition.modifications[0].decisionId, audit.id);
      }
      same(row, { ...prior, revision: prior.revision + 1, updated_at: row.updated_at,
        definition: { ...prior.definition, issued: expected.issued, provisional: false, modifications: row.definition.modifications } });
    }
    same(after.history.map(({ workout, ...actual }) => ({ id: workout.id, ...actual })),
      before.history.map(({ workout, ...actual }) => ({ id: workout.id, ...actual })));
    expect(after.plan.state.acceptedCalibration).toBeNull();
    same(after.plan, { ...before.plan, revision: before.plan.revision + 1, updated_at: after.plan.updated_at,
      state: { ...before.plan.state, decisions: [audit] } });
    expect(deriveSwimWeekCandidate(after.plan, after.history, today)).toBeNull();
    await page.reload();
    await page.getByText("Past decisions", { exact: true }).click();
    await expect(page.getByText("Accepted", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Review next week", exact: true }).click();
    await expect(page.getByRole("button", { name: "Review next week", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    same(await saved(actor, created.plan.id), after);
  });

  test("B6 DC-SW1/DC-SW3: a short calibrated budget preserves whole-length workout purpose", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const form = await budgetSetup(page, ["4:00", "8:30"]);
    const preview = await setupPreview(form);
    expect(preview.calibration !== null).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), { plans: [], workouts: [] })).toBe(true);
    await form.getByRole("button", { name: "Preview plan", exact: true }).click();
    await form.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);
    const stored = await setupRows(actor, freshUser.userId);
    assertSetupWorkouts(stored, preview, 10);
    const definition = swimPlanDefinition(stored.plans[0]);
    const larger = generateSwimPlan({
      setup: { ...definition.setup, sessionBudgetMinutes: 60 },
      calibration: stored.plans[0].state.acceptedCalibration,
      weeks: standaloneWeekRequests(definition.schedule.startDate, definition.schedule.weeks, definition.schedule.weekdays),
    });
    if (!larger.ok) throw new Error("Larger synthetic budget must generate.");
    const largerSlots = larger.value.weeks.flatMap((week) => week.slots);
    expect(largerSlots.length).toBe(stored.workouts.length);
    for (const row of stored.workouts) {
      const reference = largerSlots.find((slot) => slot.slotId === swimWorkoutDefinition(row).slotId);
      if (!reference || reference.kind !== "workout") throw new Error("Missing larger-budget reference.");
      expect(row.definition.issued.budget.minutes).toBe(10);
      expect(row.definition.issued.budget.accountedMs).toBeLessThanOrEqual(10 * 60_000);
      expect(row.definition.issued.totalLengths).toBeLessThan(reference.issued.totalLengths);
      expect(row.definition.issued.budget.accountedMs).toBeLessThan(reference.issued.budget.accountedMs);
    }
    const workoutPath = `/app/swim/${stored.workouts[0].id}`;
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").getByRole("link")
      .and(page.locator(`[href="${workoutPath}"]`)).click();
    await expect(page).toHaveURL(new URL(workoutPath, baseURL!).href);
    await expect(page.locator("main > section").first().getByText("50 m", { exact: true })).toBeVisible();
    await expect(page.getByText(/Up to 10 min/)).toBeVisible();
    const workoutView = page.locator("main.cp-main > main");
    await expect(workoutView).toHaveCount(1);
    const issuedView = await workoutView.innerText();
    await page.reload();
    await expect(page.getByText(/Up to 10 min/)).toBeVisible();
    await expect(workoutView).toHaveCount(1);
    expect(isDeepStrictEqual(await workoutView.innerText(), issuedView)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), stored)).toBe(true);
  });

  test("B7 DC-SW2/DC-SW3: an impossible calibrated budget creates no plan and can be corrected", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const form = await budgetSetup(page, ["16:00", "34:00"]);
    const preview = await setupPreview(form);
    expect(preview.calibration !== null).toBe(true);
    const slots = preview.generated.weeks.flatMap((week) => week.slots);
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      if (slot.kind !== "conflict") throw new Error("Expected an impossible calibrated budget.");
      expect(slot.conflict.code).toBe("budget_impossible");
      expect(slot.conflict.details?.accounts).toBe("whole_session");
      expect(Number(slot.conflict.details?.minimumMinutes)).toBeGreaterThan(10);
    }
    await form.getByRole("button", { name: "Preview plan", exact: true }).click();
    const alert = form.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert.locator("p")).toContainText(/\S/);
    await expect(alert.getByRole("listitem")).toHaveCount(3);
    for (const option of await alert.getByRole("listitem").all()) await expect(option).toContainText(/\S/);
    await expect(page).toHaveURL(/\/app\/swim\/setup$/);
    expect(isDeepStrictEqual((await setupPreview(form)).entries, preview.entries)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), { plans: [], workouts: [] })).toBe(true);

    const budget = form.getByLabel("Minutes per swim", { exact: true });
    expect(Number(await budget.getAttribute("max"))).toBeGreaterThanOrEqual(20);
    await budget.fill("20");
    const corrected = await setupPreview(form);
    expect(isDeepStrictEqual(corrected.entries, preview.entries.map(([key, value]) =>
      [key, key === "timeBudgetMinutes" ? "20" : value]))).toBe(true);
    expect(corrected.generated.weeks.every((week) => week.slots.every((slot) => slot.kind === "workout"))).toBe(true);
    await form.getByRole("button", { name: "Preview plan", exact: true }).click();
    await form.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);
    const stored = await setupRows(actor, freshUser.userId);
    assertSetupWorkouts(stored, corrected, 20);
    const workoutPath = `/app/swim/${stored.workouts[0].id}`;
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").getByRole("link")
      .and(page.locator(`[href="${workoutPath}"]`)).click();
    await expect(page).toHaveURL(new URL(workoutPath, baseURL!).href);
    await expect(page.locator("main > section").first().getByText("50 m", { exact: true })).toBeVisible();
    await expect(page.getByText(/Up to 20 min/)).toBeVisible();
    const workoutView = page.locator("main.cp-main > main");
    await expect(workoutView).toHaveCount(1);
    const issuedView = await workoutView.innerText();
    await page.reload();
    await expect(page.getByText(/Up to 20 min/)).toBeVisible();
    await expect(workoutView).toHaveCount(1);
    expect(isDeepStrictEqual(await workoutView.innerText(), issuedView)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), stored)).toBe(true);
  });

  test("B8 DC-SW2/DC-SW3: beginner setup offers learning guidance instead of a workout", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const form = await budgetSetup(page);
    await expect(form.getByLabel("Recent comfortable non-stop lengths", { exact: true })).toHaveAttribute("min", "0");
    const preview = await setupPreview(form);
    expect(preview.input.setup.recentComfortableLengths).toBe(0);
    expect(preview.input.setup.knownStrokes).toHaveLength(0);
    expect(preview.input.setup.benchmarks).toBeUndefined();
    expect(preview.input.observation).toBeNull();
    expect(preview.calibration).toBeNull();
    expect(preview.generated.calibration).toBeNull();
    expect(preview.entries.every(([key, value]) =>
      key !== "verified" && (!["time200", "time400", "benchmarkDate"].includes(key) || value === ""))).toBe(true);
    const slots = preview.generated.weeks.flatMap((week) => week.slots);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.kind === "guidance" && slot.guidance.steps.length > 0)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), { plans: [], workouts: [] })).toBe(true);
    await form.getByRole("button", { name: "Preview plan", exact: true }).click();
    await expect(form.getByRole("status")).toBeVisible();
    await expect(form.getByRole("status")).toContainText(/\S/);
    const guidance = slots[0];
    if (guidance.kind !== "guidance") throw new Error("Expected learning guidance.");
    expect(isDeepStrictEqual(await form.getByRole("status").innerText(), guidance.guidance.steps.join(" "))).toBe(true);
    await expect(form.getByRole("alert")).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/swim\/setup$/);
    expect(isDeepStrictEqual((await setupPreview(form)).entries, preview.entries)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), { plans: [], workouts: [] })).toBe(true);
  });

  test("B9 DC-SW5/DC-SW7/DC-SW8: concurrent reviewed recommendations and dates keep one accepted decision", async ({
    page, context, browser, freshUser, seedConfig, baseURL, actor, admin,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    const today = await page.getByLabel("Start date", { exact: true }).inputValue();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const userId = freshUser.userId;
    const movement = await admin.from("movements").select("id,display_name")
      .is("user_id", null).eq("slug", "bench-press-flat").single();
    expect(!movement.error && typeof movement.data?.id === "string" &&
      typeof movement.data?.display_name === "string").toBe(true);
    const prescription = { items: [{
      movementId: movement.data!.id, movementName: movement.data!.display_name, kind: "main" as const, sets: 3, reps: 5,
    }] };
    const { plannedIds } = await seedSwimPrimaryBaseline(actor, userId, addDaysToYmd(today, -7), prescription);
    const linked = await admin.from("planned_sessions").select("completed_session_id")
      .eq("user_id", userId).eq("id", plannedIds[0]).single();
    expect(!linked.error && typeof linked.data?.completed_session_id === "string").toBe(true);
    const set = await admin.from("set_logs").insert({
      session_id: linked.data!.completed_session_id, movement_id: movement.data!.id, set_index: 1,
      weight_kg: 40, reps: 5, rpe: 7, set_kind: "main", skipped: false,
    });
    expect(set.error === null).toBe(true);
    const created = await arrangePlan(actor, today);
    const initial = await saved(actor, created.plan.id);
    for (const workout of initial.workouts.slice(0, 2)) {
      const started = await startSwimWorkout(actor, workout.id, workout.revision);
      await completeSwimWorkout(actor, {
        workoutId: started.id, expectedRevision: started.revision,
        clientLogId: randomUUID(), completionEntryId: randomUUID(),
        result: {
          version: 1, snapshot: started.definition.issued.snapshot,
          lengths: started.definition.issued.totalLengths, timeMs: 1200000, rpe: 5,
          completion: "completed", provenance: { source: "manual", recordedAt: new Date().toISOString() },
        },
      });
    }
    await startSwimWorkout(actor, initial.workouts[2].id, initial.workouts[2].revision);
    const before = await saved(actor, created.plan.id);
    expect(before.history.slice(0, 2).every((row) =>
      row.workout.status === "completed" && !!row.completedAt && row.result?.rpe === 5 &&
      row.result.lengths === row.workout.definition.issued.totalLengths && !row.deleted && !row.sourceGone,
    )).toBe(true);
    async function retained() {
      const rows = await Promise.all([
        actor.from("training_blocks").select("*").eq("user_id", userId).order("id"),
        actor.from("planned_sessions").select("*").eq("user_id", userId).order("id"),
        actor.from("sessions").select("*").eq("user_id", userId).order("id"),
        actor.from("region_state").select("*").eq("user_id", userId).order("region"),
      ]);
      expect(rows.every((row) => !row.error && Array.isArray(row.data))).toBe(true);
      expect(rows[0].data?.length).toBe(1);
      expect(rows[1].data?.length).toBe(2);
      expect(rows[2].data?.length).toBe(4);
      const sessionIds = rows[2].data!.map((row) => row.id);
      const logs = await Promise.all([
        actor.from("cardio_logs").select("*").in("session_id", sessionIds).order("id"),
        actor.from("set_logs").select("*").in("session_id", sessionIds).order("id"),
      ]);
      expect(logs.every((row) => !row.error && Array.isArray(row.data))).toBe(true);
      expect(logs[0].data?.length).toBe(2);
      expect(logs[1].data?.length).toBe(1);
      return [...rows, ...logs].map((row) => row.data);
    }
    const protectedRows = await retained();
    const candidate = deriveSwimWeekCandidate(before.plan, before.history, today);
    if (!candidate || candidate.proposal.decision !== "progress") throw new Error("Expected improving candidate.");
    same(candidate.targetWorkoutIds, before.workouts.slice(2, 4).map((row) => row.id));
    const second = await browser.newContext({
      baseURL, viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true,
    });
    try {
      await signInAs(second, freshUser, seedConfig, baseURL!);
      const other = await second.newPage();
      const pages = [page, other];
      const stale = (view: Page) => view.getByRole("alert")
        .and(view.locator(":not(#__next-route-announcer__)")).filter({ hasText: /changed.*reload/i });
      function submittedArguments(request: Request): unknown[] {
        try {
          const args: unknown = JSON.parse(request.postData()!);
          if (Array.isArray(args)) return args;
        } catch { /* Never include private request bodies in failures. */ }
        throw new Error("Could not read the synthetic decision submission.");
      }
      async function race(button: string, success: (view: Page) => Locator) {
        const requests: Request[][] = pages.map(() => []);
        let overflow = false;
        const listeners = pages.map((view, index) => {
          const capture = (request: Request) => {
            const url = new URL(request.url());
            if (request.method() !== "POST" || !request.headers()["next-action"] ||
              url.origin !== new URL(baseURL!).origin || url.pathname !== "/app/swim") return;
            if (requests[index].length < 2) requests[index].push(request);
            else overflow = true;
          };
          view.on("request", capture);
          return capture;
        });
        try {
          await Promise.all(pages.map((view) => view.getByRole("button", { name: button, exact: true }).click()));
          await Promise.all(pages.map((view) => expect(success(view).or(stale(view))).toBeVisible()));
          expect(!overflow && requests.every((entries) => entries.length === 1)).toBe(true);
          const rejected = await Promise.all(pages.map((view) => stale(view).isVisible()));
          expect(rejected.filter(Boolean)).toHaveLength(1);
          const winner = rejected.indexOf(false);
          await expect(stale(pages[1 - winner])).toBeVisible();
          await expect(success(pages[winner])).toBeVisible();
          return { winner, args: requests.map((entries) => submittedArguments(entries[0])) };
        } finally {
          pages.forEach((view, index) => view.off("request", listeners[index]));
        }
      }
      await Promise.all(pages.map(async (view) => {
        await view.goto(`/app/swim?plan=${created.plan.id}`);
        await view.getByRole("button", { name: "Review next week", exact: true }).click();
        await expect(view.getByRole("heading", { name: "Progress · Week 2", exact: true })).toBeVisible();
        await expect(view.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
      }));
      same(await saved(actor, created.plan.id), before);
      const accepted = await race("Accept", (view) => view.getByText("Past decisions", { exact: true }));
      for (const args of accepted.args) same(args, [before.plan.id, before.plan.revision, candidate.id, "accepted"]);
      await pages[accepted.winner].getByText("Past decisions", { exact: true }).click();
      await expect(pages[accepted.winner].getByText("Accepted", { exact: true })).toBeVisible();
      await expect(pages[1 - accepted.winner].getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
      const after = await saved(actor, created.plan.id);
      expect(after.plan.state.decisions.length).toBe(before.plan.state.decisions.length + 1);
      const audit = after.plan.state.decisions.at(-1)!;
      same([audit.id, audit.kind, audit.decision, audit.ruleVersion, audit.generatorVersion],
        [candidate.id, "progression", "accepted", SWIM_GENERATOR_VERSION, SWIM_GENERATOR_VERSION]);
      const engineDecision = audit.inputSnapshot.engineDecision;
      if (!engineDecision || typeof engineDecision !== "object" ||
        !("atISO" in engineDecision) || typeof engineDecision.atISO !== "string") {
        throw new Error("Missing persisted engine decision timestamp.");
      }
      expect(Number.isFinite(Date.parse(engineDecision.atISO)) && Number.isFinite(Date.parse(audit.recordedAt))).toBe(true);
      const ledger = recordSwimDecision(null, {
        proposal: candidate.proposal, action: "accept", atISO: engineDecision.atISO,
      });
      same(audit.inputSnapshot, JSON.parse(JSON.stringify({
        ...candidate.exactInputs, proposal: candidate.proposal,
        engineDecision: ledger.entries[0], appliedDose: candidate.proposal.to,
      })));
      same(after.plan, {
        ...before.plan, revision: before.plan.revision + 1, updated_at: after.plan.updated_at,
        state: { ...before.plan.state, decisions: [...before.plan.state.decisions, audit] },
      });
      for (const [index, row] of after.workouts.entries()) {
        const prior = before.workouts[index];
        if (index !== 3) { same(row, prior); continue; }
        const expected = candidate.generated.weeks[1].slots.find((slot) => slot.slotId === swimWorkoutDefinition(row).slotId);
        if (!expected || expected.kind !== "workout") throw new Error("Missing expected target.");
        expect(row.definition.modifications.length).toBe(1);
        const modification = row.definition.modifications[0];
        same([modification.previous, modification.decisionId], [prior.definition.issued, audit.id]);
        expect(typeof modification.id === "string" && Number.isFinite(Date.parse(modification.recordedAt))).toBe(true);
        same(row, {
          ...prior, revision: prior.revision + 1, updated_at: row.updated_at,
          definition: { ...prior.definition, issued: expected.issued, provisional: false, modifications: [modification] },
        });
        expect(isDeepStrictEqual(row.definition.issued, prior.definition.issued)).toBe(false);
      }
      same(after.history.slice(0, 3), before.history.slice(0, 3));
      same(after.history, before.history.map((entry) => ({
        ...entry, workout: after.workouts.find((row) => row.id === entry.workout.id),
      })));
      same(await retained(), protectedRows);
      expect(deriveSwimWeekCandidate(after.plan, after.history, today)).toBeNull();
      await Promise.all(pages.map(async (view) => {
        await view.reload();
        await openSwimProgramActions(view);

        await expect(view.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
        await expect(view.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
      }));
      same(await saved(actor, created.plan.id), after);
      same(await page.locator("main.cp-main").innerText(), await other.locator("main.cp-main").innerText());
      await openSwimProgramActions(page);

      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(page.getByLabel("Resume from", { exact: true })).toBeVisible();
      const paused = await saved(actor, created.plan.id);
      expect(paused.plan.status).toBe("paused");
      expect(paused.plan.revision).toBe(after.plan.revision + 1);
      same(paused.workouts, after.workouts);
      const pause = paused.plan.state.pauseSnapshot;
      const pausedTransition = paused.plan.state.lifecycle?.at(-1);
      if (!pause || !pausedTransition) throw new Error("Missing paused schedule.");
      same(pause.workoutIds, after.workouts.filter((row) => row.status === "scheduled" && !row.session_id).map((row) => row.id));
      same([pausedTransition.from, pausedTransition.to, pause.pausedAt],
        ["active", "paused", pausedTransition.recordedAt]);
      expect(Number.isFinite(Date.parse(pause.pausedAt))).toBe(true);
      same(paused.plan, {
        ...after.plan, status: "paused", revision: after.plan.revision + 1, updated_at: paused.plan.updated_at,
        state: { ...after.plan.state, pauseSnapshot: pause, lifecycle: [...(after.plan.state.lifecycle ?? []), pausedTransition] },
      });
      same(paused.history, after.history);
      same(await retained(), protectedRows);
      await other.reload();
      await expect(other.getByLabel("Resume from", { exact: true })).toBeVisible();
      const min = await page.getByLabel("Resume from", { exact: true }).getAttribute("min");
      expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      same(await other.getByLabel("Resume from", { exact: true }).getAttribute("min"), min);
      const starts = [addDaysToYmd(min!, 7), addDaysToYmd(min!, 14)];
      const reviewed: string[][] = [];
      for (const [index, view] of pages.entries()) {
        await view.getByLabel("Resume from", { exact: true }).fill(starts[index]);
        const request = view.waitForRequest((request) => request.method() === "POST" &&
          !!request.headers()["next-action"] && new URL(request.url()).pathname === "/app/swim");
        await view.getByRole("button", { name: "Preview dates", exact: true }).click();
        same(submittedArguments(await request), [paused.plan.id, paused.plan.revision, starts[index]]);
        await expect(view.getByRole("button", { name: "Accept dates and resume", exact: true })).toBeEnabled();
        reviewed[index] = await view.getByRole("heading", { name: "New swim dates", exact: true })
          .locator("..").getByRole("listitem").allTextContents();
        expect(reviewed[index].length).toBe(3);
      }
      same(reviewed[1], reviewed[0].map((date) => addDaysToYmd(date, 7)));
      same(await saved(actor, created.plan.id), paused);
      const reviewedSchedule = await loadTrainingSchedule(actor);
      expect(reviewedSchedule.entries.filter((entry) =>
        !(entry.source === "swim" && entry.programId === created.plan.id) && reviewed.flat().includes(entry.date))).toHaveLength(0);
      await Promise.all(pages.map(openSwimProgramActions));
      const resumed = await race("Accept dates and resume", (view) => view.getByRole("button", { name: "Pause", exact: true }));
      const previews = resumed.args.map((args, index) => {
        expect(args.length).toBe(2);
        same(args[1], false);
        const preview = args[0] as SwimResumePreview;
        const remaining = paused.workouts.filter((row) => row.status === "scheduled" && !row.session_id);
        same(preview, {
          planId: paused.plan.id, revision: paused.plan.revision, startDate: starts[index],
          dates: remaining.map((row, position) => ({ id: row.id, revision: row.revision, date: reviewed[index][position] })),
          scheduleRevision: reviewedSchedule.revision, overlaps: [],
        });
        return preview;
      });
      const winning = previews[resumed.winner];
      const rejectedPage = pages[1 - resumed.winner];
      same(await rejectedPage.getByLabel("Resume from", { exact: true }).inputValue(), starts[1 - resumed.winner]);
      same(await rejectedPage.getByRole("heading", { name: "New swim dates", exact: true })
        .locator("..").getByRole("listitem").allTextContents(), reviewed[1 - resumed.winner]);
      await expect(rejectedPage.getByRole("button", { name: "Accept dates and resume", exact: true })).toBeEnabled();
      const final = await saved(actor, created.plan.id);
      expect(final.plan.status).toBe("active");
      expect(final.plan.revision).toBe(paused.plan.revision + 1);
      expect(final.plan.state.decisions.length).toBe(paused.plan.state.decisions.length + 1);
      const schedule = final.plan.state.decisions.at(-1)!;
      same([schedule.kind, schedule.decision, schedule.inputSnapshot], ["schedule", "accepted", { preview: winning }]);
      same([schedule.ruleVersion, schedule.generatorVersion], [SWIM_SCHEDULE_VERSION, SWIM_GENERATOR_VERSION]);
      expect(typeof schedule.id === "string" && schedule.id !== audit.id &&
        Number.isFinite(Date.parse(schedule.recordedAt))).toBe(true);
      const transition = final.plan.state.lifecycle?.at(-1);
      if (!transition) throw new Error("Missing resume lifecycle record.");
      same([transition.from, transition.to], ["paused", "active"]);
      expect(Number.isFinite(Date.parse(transition.recordedAt))).toBe(true);
      same(final.plan, {
        ...paused.plan, status: "active", revision: paused.plan.revision + 1, updated_at: final.plan.updated_at,
        ends_on: [paused.plan.ends_on, ...winning.dates.map((entry) => entry.date)].sort().at(-1),
        state: {
          ...paused.plan.state, decisions: [...paused.plan.state.decisions, schedule],
          lifecycle: [...(paused.plan.state.lifecycle ?? []), transition],
        },
      });
      for (const row of final.workouts) {
        const prior = paused.workouts.find((workout) => workout.id === row.id)!;
        const entry = winning.dates.find((date) => date.id === row.id);
        same(row, entry ? {
          ...prior, scheduled_date: entry.date, revision: prior.revision + 1, updated_at: row.updated_at,
        } : prior);
      }
      same(final.history.filter((row) => !!row.workout.session_id), before.history.filter((row) => !!row.workout.session_id));
      same(final.history, paused.history.map((entry) => ({
        ...entry, workout: final.workouts.find((row) => row.id === entry.workout.id),
      })));
      same(await retained(), protectedRows);
      const canonicalDisplay = await pages[resumed.winner].locator("main.cp-main").innerText();
      await Promise.all(pages.map(async (view) => {
        await view.reload();
        await openSwimProgramActions(view);

        await expect(view.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
        await expect(stale(view)).toHaveCount(0);
        await expect(view.getByRole("button", { name: "Accept dates and resume", exact: true })).toHaveCount(0);
        same(await view.locator("main.cp-main").innerText(), canonicalDisplay);
      }));
      same(await saved(actor, created.plan.id), final);
      same(await retained(), protectedRows);
    } finally { await second.close(); }
  });
});
