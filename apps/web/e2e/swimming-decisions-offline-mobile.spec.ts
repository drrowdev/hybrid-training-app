import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateSwimPlan, recordSwimDecision, SWIM_GENERATOR_VERSION } from "@hta/engine";
import type { SwimSetup } from "@hta/domain";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd, isoWeekdayYmd } from "../src/lib/dates";
import {
  standaloneWeekRequests, swimWorkoutDefinition,
  type StandalonePlanDefinition, type StandaloneWorkoutDefinition,
} from "../src/lib/swim/model";
import { deriveSwimWeekCandidate, loadSwimHistory } from "../src/lib/swim/queries";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout, listSwimPlans, listSwimWorkouts,
  type SwimWorkoutInput,
} from "../src/lib/swim/storage";
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
      const tx = db.transaction("outbox", "readonly");
      const request = tx.objectStore("outbox").getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result as OutboxEntry[]); };
      tx.onerror = () => { db.close(); reject(new Error("Native outbox read failed.")); };
    };
  }));
  return sortBySeq(rows);
}

function durable(entries: OutboxEntry[]) {
  return entries.map(({ id, op, sessionId, seq, createdAt, payload }) => ({ id, op, sessionId, seq, createdAt, payload }));
}

async function completionRows(client: SupabaseClient, userId: string, workoutId: string, sessionId: string) {
  const [workout, session, logs] = await Promise.all([
    client.from("swim_workouts").select("*").eq("user_id", userId).eq("id", workoutId).single(),
    client.from("sessions").select("id,user_id,completed_at,completion_outbox_entry_id,duration_min,session_rpe,notes")
      .eq("user_id", userId).eq("id", sessionId).single(),
    client.from("cardio_logs").select("id,session_id,client_log_id,swim_result,duration_sec,distance_km,rpe,notes")
      .eq("session_id", sessionId).order("id"),
  ]);
  expect(!workout.error && !session.error && !logs.error, "Synthetic completion rows readable").toBe(true);
  if (!workout.data || !session.data || !logs.data) throw new Error("Missing synthetic completion rows.");
  same(workout.data.session_id, sessionId);
  return { workout: workout.data, session: session.data, logs: logs.data };
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

    const lost = Promise.withResolvers<void>();
    const replayArrived = Promise.withResolvers<void>();
    const allowReplay = Promise.withResolvers<void>();
    const subsequentArrived = Promise.withResolvers<void>();
    const allowSubsequent = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    let sends = 0;
    let firstCommit: Awaited<ReturnType<typeof completionRows>> | undefined;
    const ownedPaths = new Set(started.map((row) => `/app/swim/${row.id}`));
    await context.route((url) => url.origin === new URL(baseURL!).origin && ownedPaths.has(url.pathname), async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) {
        await route.continue();
        return;
      }
      const ordinal = ++sends;
      expect(ordinal).toBeLessThanOrEqual(3);
      const entry = original[ordinal === 3 ? 1 : 0];
      // The caller URL can be the OTHER workout. Identify the queued action by its native IDs.
      const body = request.postData() ?? "";
      expect([entry.id, entry.sessionId, entry.payload.workoutId].every((id) => body.includes(id)),
        "Owned native completion request identity").toBe(true);
      if (ordinal === 2) {
        replayArrived.resolve();
        await allowReplay.promise;
      }
      if (ordinal === 3) {
        same(durable(await queueRows(secondPage)), durable([original[1]]));
        same(await completionRows(actor, freshUser.userId, started[0].id, original[0].sessionId), firstCommit);
        subsequentArrived.resolve();
        await allowSubsequent.promise;
      }
      const response = await route.fetch();
      const rows = await completionRows(actor, freshUser.userId, entry.payload.workoutId, entry.sessionId);
      committed(rows, entry);
      if (ordinal === 1) {
        firstCommit = rows;
        // Receipt, result and session are observed committed BEFORE discarding the response.
        await context.setOffline(true);
        await route.abort("failed");
        lost.resolve();
      } else {
        if (ordinal === 2) same(rows, firstCommit);
        await route.fulfill({ response });
        if (ordinal === 3) drained.resolve();
      }
    });
    try {
      await context.setOffline(false);
      await lost.promise;
      await expect.poll(async () => {
        const rows = await queueRows(secondPage);
        return rows.length === 2 && rows.every((row) => !row.leaseToken) &&
          rows[0].attempts > 0 && rows[0].attempts < MAX_REPLAY_ATTEMPTS;
      }).toBe(true);
      same(durable(await queueRows(secondPage)), durable(original));
      expect(sends).toBe(1);
      await expect(page.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled();
      await expect(secondPage.getByRole("button", { name: "Waiting to sync", exact: true })).toBeDisabled();

      // Relaunch only after the failed drain released its lease; IDB stays in this context.
      await page.close();
      await context.setOffline(false);
      await replayArrived.promise;
      const reopened = await context.newPage();
      await reopened.goto(`/app/swim/${started[0].id}`);
      await expect(reopened.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      await expect(reopened.getByRole("button", { name: "Edit result", exact: true })).toBeVisible();
      same(durable(await queueRows(reopened)), durable(original));
      const waiting = await queueRows(reopened);
      expect(waiting[0].leaseToken !== undefined).toBe(true);
      expect(waiting[0].attempts).toBeLessThan(MAX_REPLAY_ATTEMPTS);
      expect(waiting[1].leaseToken).toBeUndefined();
      expect(waiting[1].attempts).toBe(0);
      expect(sends).toBe(2);
      const untouched = await completionRows(actor, freshUser.userId, started[1].id, original[1].sessionId);
      expect(untouched.workout.status).toBe("started");
      expect(untouched.session.completed_at).toBeNull();
      expect(untouched.session.completion_outbox_entry_id).toBeNull();
      expect(untouched.logs).toHaveLength(0);

      allowReplay.resolve();
      await subsequentArrived.promise;
      same(durable(await queueRows(reopened)), durable([original[1]]));
      allowSubsequent.resolve();
      await drained.promise;
      await expect.poll(async () => (await queueRows(reopened)).length).toBe(0);
      expect(sends).toBe(3);
      same(await completionRows(actor, freshUser.userId, started[0].id, original[0].sessionId), firstCommit);
      committed(await completionRows(actor, freshUser.userId, started[1].id, original[1].sessionId), original[1]);
      await secondPage.reload();
      for (const [index, tab] of [reopened, secondPage].entries()) {
        await expect(tab.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
        const result = tab.getByRole("heading", { name: "Your swim", exact: true }).locator("..");
        await expect(result).toContainText(`${original[index].payload.lengths} lengths`);
        await expect(result).toContainText(index === 0 ? "20:00" : "21:00");
        await expect(result).toContainText("RPE 5");
        await expect(tab.getByRole("button", { name: "Finish swim", exact: true })).toHaveCount(0);
        await expect(tab.getByRole("button", { name: "Waiting to sync", exact: true })).toHaveCount(0);
        await expect(tab.getByRole("button", { name: "Edit result", exact: true })).toBeVisible();
      }
    } finally {
      allowReplay.resolve();
      allowSubsequent.resolve();
      await context.unrouteAll({ behavior: "wait" });
    }
  });
});
