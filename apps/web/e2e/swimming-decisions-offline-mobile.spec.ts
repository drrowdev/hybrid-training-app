import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
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
  const weekdays = [isoWeekdayYmd(startDate) % 7, isoWeekdayYmd(addDaysToYmd(startDate, 3)) % 7];
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
  return createSwimPlan(client, {
    startedOn: startDate, endsOn: addDaysToYmd(startDate, 20), definition,
    state: { version: 1, observations: [], acceptedCalibration: null, decisions: [] }, workouts,
  });
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
    same(audit.inputSnapshot, {
      ...candidate.exactInputs, proposal: candidate.proposal,
      engineDecision: audit.inputSnapshot.engineDecision, appliedDose: candidate.proposal.to,
    });
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
});
