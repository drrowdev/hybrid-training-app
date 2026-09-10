import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applySwimProposal, generateSwimPlan, recordSwimDecision, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { estimateCriticalSwimSpeed, swimWorkoutLengths, validateSwimWorkout, type SwimSetup } from "@hta/domain";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd, isoWeekdayYmd } from "../src/lib/dates";
import {
  standaloneWeekRequests, swimPlanDefinition, swimWorkoutDefinition,
  type StandalonePlanDefinition, type StandaloneWorkoutDefinition,
} from "../src/lib/swim/model";
import { deriveSwimWeekCandidate, loadSwimHistory, persistedSwimPlan } from "../src/lib/swim/queries";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout, listSwimPlans, listSwimWorkouts,
  type SwimWorkoutInput,
} from "../src/lib/swim/storage";
import { parseSetupForm } from "../src/lib/swim/forms";
import { MAX_REPLAY_ATTEMPTS, sortBySeq, type OutboxEntry } from "../src/lib/offline/outbox-core";

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

async function queueRows(page: Page): Promise<OutboxEntry[]> {
  const rows = await page.evaluate(() => new Promise<OutboxEntry[]>((resolve, reject) => {
    const open = indexedDB.open("hta-offline", 1);
    // Observation must never create or repair the application's outbox.
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

function durable(entries: OutboxEntry[]) {
  return entries.map(({ id, op, sessionId, seq, createdAt, payload }) => ({ id, op, sessionId, seq, createdAt, payload }));
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

function committed(rows: Awaited<ReturnType<typeof completionRows>>, entry: OutboxEntry) {
  expect(rows.workout.status).toBe("completed");
  expect(typeof rows.session.completed_at === "string").toBe(true);
  same(rows.session.completion_outbox_entry_id, entry.id);
  expect(rows.logs).toHaveLength(1);
  const log = rows.logs[0];
  same(log.client_log_id, entry.id);
  same(log.session_id, entry.sessionId);
  same(log.swim_result.snapshot, rows.workout.definition.issued.snapshot);
  expect(log.swim_result.lengths).toBe(Number(entry.payload.lengths));
  expect(log.swim_result.timeMs).toBe(Number(entry.payload.timeMs));
  expect(log.swim_result.rpe).toBe(Number(entry.payload.rpe));
  expect(log.swim_result.completion).toBe("completed");
  expect(log.duration_sec).toBe(Number(entry.payload.timeMs) / 1000);
  expect(rows.session.duration_min).toBe(Number(entry.payload.timeMs) / 60000);
  expect(Number(rows.session.session_rpe)).toBe(Number(entry.payload.rpe));
}

async function budgetSetup(page: Page, times?: readonly [string, string]) {
  await page.goto("/app/swim/setup");
  const form = page.locator("form").filter({ has: page.getByRole("combobox", { name: "Pool length", exact: true }) });
  await expect(form).toHaveCount(1);
  await form.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("50m");
  await form.getByRole("combobox", { name: "Goal", exact: true }).selectOption("endurance");
  await form.getByRole("combobox", { name: "Swimming experience", exact: true }).selectOption(times ? "regular" : "beginner");
  await form.getByLabel("Recent comfortable continuous lengths", { exact: true }).fill(times ? "12" : "0");
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
  expect(isDeepStrictEqual(audit.inputSnapshot, { ...preview.input, versions: preview.generated.versions })).toBe(true);
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

test.describe("ADR0079 later-cohort B swimming decisions and offline durability", () => {
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

  test("B2 DC-SW8: native completion survives a committed lost response and replays before another session", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await page.goto("/app/swim/setup");
    await page.getByRole("combobox", { name: "Pool length", exact: true }).selectOption("25yd");
    await page.getByLabel("Recent comfortable continuous lengths", { exact: true }).fill("12");
    await page.getByLabel("Weeks", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=[^&]+$/);
    const plans = await listSwimPlans(actor);
    expect(plans).toHaveLength(1);
    const workouts = await listSwimWorkouts(actor, plans[0].id);
    expect(workouts).toHaveLength(4);
    const secondPage = await context.newPage();
    const pages = [page, secondPage];
    for (const [index, tab] of pages.entries()) {
      await tab.goto(`/app/swim/${workouts[index].id}`);
      await tab.getByRole("button", { name: "Start swim", exact: true }).click();
      await expect(tab.getByRole("link", { name: "Log swim", exact: true })).toBeVisible();
      await tab.getByLabel("Whole lengths", { exact: true }).fill(String(workouts[index].definition.issued.totalLengths));
      await tab.getByLabel("Time · min:sec", { exact: true }).fill(index === 0 ? "20:00" : "21:00");
      await tab.getByRole("radio", { name: "5 easy", exact: true }).click();
    }
    const started = (await listSwimWorkouts(actor, plans[0].id)).slice(0, 2);
    expect(started.every((row) => row.status === "started" && !!row.session_id)).toBe(true);
    expect(new Set(started.map((row) => row.session_id)).size).toBe(2);
    await context.setOffline(true);
    for (const tab of pages) {
      await tab.getByRole("button", { name: "Finish swim", exact: true }).click();
      await expect(tab.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled();
      await expect(tab.getByRole("button", { name: "Edit result", exact: true })).toHaveCount(0);
    }
    const original = await queueRows(secondPage);
    expect(original).toHaveLength(2);
    expect(new Set(original.map((row) => row.id)).size).toBe(2);
    expect(original[0].seq).toBeLessThan(original[1].seq);
    for (const [index, entry] of original.entries()) {
      expect(entry.op).toBe("swim_complete");
      same([entry.sessionId, entry.payload.sessionId, entry.payload.workoutId],
        [started[index].session_id, started[index].session_id, started[index].id]);
      expect(entry.attempts).toBe(0);
      expect(entry.leaseToken).toBeUndefined();
      const rows = await completionRows(actor, freshUser.userId, started[index].id, entry.sessionId);
      expect(rows.workout.status).toBe("started");
      expect(rows.session.completed_at).toBeNull();
      expect(rows.session.completion_outbox_entry_id).toBeNull();
      expect(rows.logs).toHaveLength(0);
    }
    same(durable(await queueRows(page)), durable(original));

    type RequestObservation = { ordinal: number; identityMatches: boolean };
    type CompletionObservation = RequestObservation & {
      rows: Awaited<ReturnType<typeof observeCompletionRows>>;
    };
    function assertRequest(observation: RequestObservation) {
      expect(observation.ordinal).toBeLessThanOrEqual(3);
      expect(observation.identityMatches, "Owned native completion request identity").toBe(true);
    }
    const lost = Promise.withResolvers<CompletionObservation | Error>();
    const replayArrived = Promise.withResolvers<CompletionObservation | Error>();
    const allowReplay = Promise.withResolvers<void>();
    const subsequentArrived = Promise.withResolvers<RequestObservation & {
      queue: OutboxEntry[]; head: Awaited<ReturnType<typeof observeCompletionRows>>;
    } | Error>();
    const allowSubsequent = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<CompletionObservation | Error>();
    const failed = Promise.withResolvers<Error>();
    let handlerFailure: Error | undefined;
    let stopping = false;
    let cleanupFailed = false;
    let primaryFailure: unknown;
    let bodyFailed = false;
    function failHandler() {
      handlerFailure ??= new Error("B2 owned completion route failed.");
      failed.resolve(handlerFailure);
    }
    async function checked<T>(pending: Promise<T | Error>): Promise<T> {
      const result = await Promise.race([pending, failed.promise]);
      if (handlerFailure) throw handlerFailure;
      if (result instanceof Error) throw result;
      return result;
    }
    let sends = 0;
    const ownedPaths = new Set(started.map((row) => `/app/swim/${row.id}`));
    await context.route((url) => url.origin === new URL(baseURL!).origin && ownedPaths.has(url.pathname), async (route) => {
      let settled = false;
      async function abort() {
        if (!settled) {
          await route.abort("failed");
          settled = true;
        }
      }
      try {
        if (stopping || handlerFailure) { await abort(); return; }
        const request = route.request();
        if (request.method() !== "POST") {
          await route.continue();
          settled = true;
          return;
        }
        const ordinal = ++sends;
        const entry = original[ordinal === 3 ? 1 : 0];
        // The caller URL can be the OTHER workout. Identify the queued action by its native IDs.
        const body = request.postData() ?? "";
        const identityMatches = !!request.headers()["next-action"] &&
          [entry.id, entry.sessionId, entry.payload.workoutId].every((id) => body.includes(id));
        if (ordinal > 3 || !identityMatches) {
          failHandler();
          await abort();
          return;
        }
        if (ordinal === 3) {
          const queue = await queueRows(secondPage);
          const head = await observeCompletionRows(actor, freshUser.userId, started[0].id, original[0].sessionId);
          subsequentArrived.resolve({ ordinal, identityMatches, queue, head });
          await allowSubsequent.promise;
        }
        if (stopping || handlerFailure) { await abort(); return; }
        const response = await route.fetch();
        const rows = await observeCompletionRows(actor, freshUser.userId, entry.payload.workoutId, entry.sessionId);
        if (stopping || handlerFailure) { await abort(); return; }
        if (ordinal === 1) {
          // Capture receipt, result and session BEFORE discarding the response.
          await context.setOffline(true);
          await abort();
          lost.resolve({ ordinal, identityMatches, rows });
        } else {
          if (ordinal === 2) {
            replayArrived.resolve({ ordinal, identityMatches, rows });
            await allowReplay.promise;
          }
          if (stopping || handlerFailure) { await abort(); return; }
          await route.fulfill({ response });
          settled = true;
          if (ordinal === 3) drained.resolve({ ordinal, identityMatches, rows });
        }
      } catch {
        failHandler();
        try { await abort(); } catch { cleanupFailed = true; }
      }
    });
    try {
      await checked(context.setOffline(false));
      const loss = await checked(lost.promise);
      assertRequest(loss);
      const firstCommit = assertCompletionRows(loss.rows, original[0].sessionId);
      committed(firstCommit, original[0]);
      await checked(expect.poll(async () => {
        const rows = await queueRows(secondPage);
        return rows.length === 2 && rows.every((row) => !row.leaseToken) &&
          rows[0].attempts > 0 && rows[0].attempts < MAX_REPLAY_ATTEMPTS;
      }).toBe(true));
      same(durable(await checked(queueRows(secondPage))), durable(original));
      expect(sends).toBe(1);
      await checked(expect(page.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled());
      await checked(expect(secondPage.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled());

      // Relaunch only after the failed drain released its lease; IDB stays in this context.
      await checked(page.close());
      await checked(context.setOffline(false));
      const reopened = await checked(context.newPage());
      await checked(reopened.goto(`/app/swim/${started[0].id}`));
      const replayed = await checked(replayArrived.promise);
      assertRequest(replayed);
      const replay = assertCompletionRows(replayed.rows, original[0].sessionId);
      committed(replay, original[0]);
      same(replay, firstCommit);
      await checked(expect(reopened.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible());
      await checked(expect(reopened.getByRole("button", { name: "Edit result", exact: true })).toBeVisible());
      same(durable(await checked(queueRows(reopened))), durable(original));
      const waiting = await checked(queueRows(reopened));
      expect(waiting[0].leaseToken !== undefined).toBe(true);
      expect(waiting[0].attempts).toBeLessThan(MAX_REPLAY_ATTEMPTS);
      expect(waiting[1].leaseToken).toBeUndefined();
      expect(waiting[1].attempts).toBe(0);
      expect(sends).toBe(2);
      const untouched = await checked(completionRows(actor, freshUser.userId, started[1].id, original[1].sessionId));
      expect(untouched.workout.status).toBe("started");
      expect(untouched.session.completed_at).toBeNull();
      expect(untouched.session.completion_outbox_entry_id).toBeNull();
      expect(untouched.logs).toHaveLength(0);

      allowReplay.resolve();
      const subsequent = await checked(subsequentArrived.promise);
      assertRequest(subsequent);
      same(durable(subsequent.queue), durable([original[1]]));
      same(assertCompletionRows(subsequent.head, original[0].sessionId), firstCommit);
      same(durable(await checked(queueRows(reopened))), durable([original[1]]));
      allowSubsequent.resolve();
      const final = await checked(drained.promise);
      assertRequest(final);
      committed(assertCompletionRows(final.rows, original[1].sessionId), original[1]);
      await checked(expect.poll(async () => (await queueRows(reopened)).length).toBe(0));
      expect(sends).toBe(3);
      same(await checked(completionRows(actor, freshUser.userId, started[0].id, original[0].sessionId)), firstCommit);
      committed(await checked(completionRows(actor, freshUser.userId, started[1].id, original[1].sessionId)), original[1]);
      await checked(secondPage.reload());
      for (const [index, tab] of [reopened, secondPage].entries()) {
        await checked(expect(tab.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible());
        const result = tab.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
        await checked(expect(result).toContainText(`${original[index].payload.lengths} lengths`));
        await checked(expect(result).toContainText(index === 0 ? "20:00" : "21:00"));
        await checked(expect(result).toContainText("RPE 5"));
        await checked(expect(tab.getByRole("button", { name: "Finish swim", exact: true })).toHaveCount(0));
        await checked(expect(tab.getByRole("button", { name: "Waiting to sync", exact: true })).toHaveCount(0));
        await checked(expect(tab.getByRole("button", { name: "Edit result", exact: true })).toBeVisible());
      }
    } catch (error) {
      bodyFailed = true;
      primaryFailure = error;
    } finally {
      stopping = true;
      try { await context.setOffline(true); } catch { cleanupFailed = true; }
      allowReplay.resolve();
      allowSubsequent.resolve();
      const stopped = new Error("B2 route observation stopped.");
      lost.resolve(stopped);
      replayArrived.resolve(stopped);
      subsequentArrived.resolve(stopped);
      drained.resolve(stopped);
      failed.resolve(stopped);
      try {
        await context.unrouteAll({ behavior: "wait" });
        await expect.poll(async () => (await queueRows(secondPage)).every((row) => !row.leaseToken)).toBe(true);
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      const cleanupFailure = new Error("B2 owned route cleanup failed.");
      if (bodyFailed) throw new AggregateError([primaryFailure, cleanupFailure], "B2 failed with incomplete cleanup.");
      if (handlerFailure) throw new AggregateError([handlerFailure, cleanupFailure], "B2 failed with incomplete cleanup.");
      throw cleanupFailure;
    }
    if (bodyFailed) throw primaryFailure;
    if (handlerFailure) throw handlerFailure;
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
    expect(isDeepStrictEqual(before.workouts.map((row) => row.definition), initial.workouts.map((row) => row.definition))).toBe(true);
    expect(isDeepStrictEqual(before.workouts[0], initial.workouts[0])).toBe(true);
    expect(before.history[0].workout.status).toBe("scheduled");
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
    await proposal.getByText("Choose a different week", { exact: true }).click();
    await proposal.getByLabel("Main repeats", { exact: true }).fill("8");
    await proposal.getByLabel("Reason", { exact: true }).fill(reason);
    await proposal.getByRole("button", { name: "Apply my choice", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "Apply my choice", exact: true })).toHaveCount(0);
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
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").getByRole("link").nth(0).click();
    await expect(page.getByText("50 m", { exact: true })).toBeVisible();
    await expect(page.getByText(/Up to 10 min/)).toBeVisible();
    const issuedView = await page.locator("main").innerText();
    await page.reload();
    await expect(page.getByText(/Up to 10 min/)).toBeVisible();
    expect(isDeepStrictEqual(await page.locator("main").innerText(), issuedView)).toBe(true);
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
    await form.getByRole("button", { name: "Create swim plan", exact: true }).click();
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
    await form.getByRole("button", { name: "Create swim plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);
    const stored = await setupRows(actor, freshUser.userId);
    assertSetupWorkouts(stored, corrected, 20);
    await page.getByRole("heading", { name: "Swims", exact: true }).locator("..").getByRole("link").nth(0).click();
    await expect(page.getByText("50 m", { exact: true })).toBeVisible();
    await expect(page.getByText(/Up to 20 min/)).toBeVisible();
    const issuedView = await page.locator("main").innerText();
    await page.reload();
    await expect(page.getByText(/Up to 20 min/)).toBeVisible();
    expect(isDeepStrictEqual(await page.locator("main").innerText(), issuedView)).toBe(true);
    expect(isDeepStrictEqual(await setupRows(actor, freshUser.userId), stored)).toBe(true);
  });

  test("B8 DC-SW2/DC-SW3: beginner setup offers learning guidance instead of a workout", async ({
    page, context, freshUser, seedConfig, baseURL, actor,
  }) => {
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const form = await budgetSetup(page);
    await expect(form.getByLabel("Recent comfortable continuous lengths", { exact: true })).toHaveAttribute("min", "0");
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
    await form.getByRole("button", { name: "Create swim plan", exact: true }).click();
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
});
