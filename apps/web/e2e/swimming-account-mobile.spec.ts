import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SwimActualResult, SwimSetup } from "@hta/domain";
import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd } from "../src/lib/dates";
import {
  standaloneWeekRequests, type StandalonePlanDefinition, type StandaloneWorkoutDefinition,
} from "../src/lib/swim/model";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout,
  type SwimWorkoutInput,
} from "../src/lib/swim/storage";

// Source-only C coverage: no active cohort selection. Later integration must bind
// the same generated LOCAL service key to SUPABASE_SERVICE_ROLE_KEY only in the
// owned Next server command's options.env and carry the accepted common fixes.
const mobile = { viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true };
type Row = Record<string, unknown> & { id: string };
type Account = {
  email: string; password: string; userId: string; client: SupabaseClient;
};

const test = seededTest.extend<{ accounts: [Account, Account] }>({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks. */
  seedConfig: async ({ baseURL }, use) => {
    // This dependency runs before admin or any synthetic-user write.
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1") {
      throw new Error("Swimming account acceptance requires the disposable loopback environment.");
    }
    if (!baseURL || !URL.canParse(baseURL) || process.env.PLAYWRIGHT_BASE_URL !== baseURL) {
      throw new Error("Swimming account acceptance requires an explicit loopback HTTP baseURL.");
    }
    const target = new URL(baseURL);
    if (target.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Swimming account acceptance requires an explicit loopback HTTP baseURL.");
    }
    const {
      E2E_SUPABASE_URL: supabaseUrl,
      E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Swimming account acceptance requires explicit dedicated seed configuration.");
    }
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
  accounts: async ({ admin, seedConfig }, use) => {
    const accounts: Account[] = [];
    try {
      for (let index = 0; index < 2; index++) {
        const email = `e2e+${randomUUID()}@hta-e2e.com`;
        const password = randomUUID();
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        expect(created.error === null).toBe(true);
        if (!created.data.user) throw new Error("Missing synthetic account.");
        const client = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const account = { email, password, userId: created.data.user.id, client };
        accounts.push(account);
        const signedIn = await client.auth.signInWithPassword({ email, password });
        expect(signedIn.error === null).toBe(true);
        expect(signedIn.data.user?.id).toBe(account.userId);
        await markOnboarded(admin, account.userId);
      }
      expect(accounts[0].userId).not.toBe(accounts[1].userId);
      await use([accounts[0], accounts[1]]);
    } finally {
      // Separate fixture teardown preserves the test's original failed assertion.
      const failures: Error[] = [];
      for (const account of accounts) {
        try {
          await cleanupAccount(admin, account);
        } catch {
          failures.push(new Error("Checked synthetic account cleanup failed."));
        }
      }
      if (failures.length) throw new AggregateError(failures, "Synthetic cleanup incomplete.");
    }
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

async function cleanupAccount(admin: SupabaseClient, account: Account) {
  const existing = await admin.auth.admin.getUserById(account.userId);
  if (!existing.data.user) {
    expect(existing.error?.status).toBe(404);
    return;
  }
  expect(existing.error === null).toBe(true);
  expect(existing.data.user.id).toBe(account.userId);
  expect(existing.data.user.email === account.email && /^e2e\+.+@hta-e2e\.com$/.test(account.email)).toBe(true);
  const deleted = await admin.auth.admin.deleteUser(account.userId);
  expect(deleted.error === null).toBe(true);
  const remaining = await admin.auth.admin.getUserById(account.userId);
  expect(remaining.data.user === null).toBe(true);
  expect(remaining.error?.status).toBe(404);
}

type NativeIds = { userId: string; planId: string; workoutIds: string[]; sessionId: string; cardioId: string };

async function nativeRows(client: SupabaseClient, ids: NativeIds) {
  const results = await Promise.all([
    client.from("swim_plans").select("*").eq("user_id", ids.userId).eq("id", ids.planId),
    client.from("swim_workouts").select("*").eq("user_id", ids.userId).eq("plan_id", ids.planId)
      .in("id", ids.workoutIds).order("id"),
    client.from("sessions").select("*").eq("user_id", ids.userId).eq("id", ids.sessionId),
    client.from("cardio_logs").select("*").eq("session_id", ids.sessionId).eq("id", ids.cardioId),
  ]);
  for (const result of results) expect(result.error === null).toBe(true);
  const [plans, workouts, sessions, cardio] = results.map((result) => (result.data ?? []) as Row[]);
  expect(plans.length).toBe(1);
  expect(workouts.map((row) => row.id).sort()).toEqual([...ids.workoutIds].sort());
  expect(sessions.length).toBe(1);
  expect(cardio.length).toBe(1);
  return { swim_plans: plans, swim_workouts: workouts, sessions, cardio_logs: cardio };
}

async function arrangeNative(account: Account, unit: "yd" | "m") {
  // Generator/model + ordinary authenticated storage are arrangement, not UI setup proof.
  const startDate = new Date().toISOString().slice(0, 10);
  const setup: SwimSetup = {
    goal: "technique_base", experience: "recreational",
    course: { numerator: unit === "yd" ? 25 : 50, denominator: 1, unit },
    knownStrokes: ["freestyle"], equipment: [], recentComfortableLengths: 12, sessionBudgetMinutes: 60,
  };
  const generated = generateSwimPlan({
    setup, calibration: null, weeks: standaloneWeekRequests(startDate, 2, [1, 4]),
  });
  if (!generated.ok) throw new Error("Synthetic swim generation failed.");
  const definition: StandalonePlanDefinition = {
    version: 1, setup, generatorVersion: SWIM_GENERATOR_VERSION,
    schedule: { startDate, weeks: 2, weekdays: [1, 4] }, initialDose: generated.value.dose,
  };
  const workouts: SwimWorkoutInput[] = generated.value.weeks.flatMap((week) => week.slots.map((slot) => {
    if (slot.kind !== "workout") throw new Error("Expected a generated native workout.");
    const definition: StandaloneWorkoutDefinition = {
      version: 1, original: slot.original, issued: slot.issued, modifications: [],
      weekIndex: week.weekIndex, slotId: slot.slotId, intent: slot.intent, provisional: week.provisional,
    };
    return { scheduled_date: slot.dateISO, slot: "single", definition };
  }));
  const created = await createSwimPlan(account.client, {
    startedOn: startDate, endsOn: addDaysToYmd(startDate, 13), definition,
    state: {
      version: 1, observations: [], acceptedCalibration: generated.value.calibration,
      decisions: [{
        id: randomUUID(), kind: "setup", decision: "accepted", recordedAt: new Date().toISOString(),
        ruleVersion: SWIM_GENERATOR_VERSION, generatorVersion: SWIM_GENERATOR_VERSION,
        inputSnapshot: { setup, startDate, weeks: 2, weekdays: [1, 4], versions: generated.value.versions },
      }],
    },
    workouts,
  });
  expect(created.plan.user_id).toBe(account.userId);
  expect(created.workouts.length).toBe(4);
  const workout = created.workouts[0];
  const started = await startSwimWorkout(account.client, workout.id, workout.revision);
  const result: SwimActualResult = {
    version: 1, snapshot: started.definition.issued.snapshot,
    lengths: started.definition.issued.totalLengths, timeMs: unit === "yd" ? 912345 : 1200123,
    rpe: 5, completion: "completed",
    provenance: { source: "manual", recordedAt: new Date().toISOString() },
  };
  const notes = `Synthetic swim ${randomUUID()}`;
  const receiptId = randomUUID();
  const completed = await completeSwimWorkout(account.client, {
    workoutId: started.id, expectedRevision: started.revision, result, notes,
    clientLogId: receiptId, completionEntryId: receiptId,
  });
  expect(completed.transitioned).toBe(true);
  expect(completed.workout.status === "completed").toBe(true);
  expect(completed.session_id).toBe(started.session_id);
  const trainingNotes = `Train consistently; synthetic ${randomUUID()}`;
  // ai_notes is nullable text in the profile schema, not a credential/vault fixture.
  const profile = await account.client.from("profiles").update({ ai_notes: trainingNotes })
    .eq("id", account.userId).select("id, ai_notes").single();
  expect(profile.error === null).toBe(true);
  expect(profile.data?.id).toBe(account.userId);
  expect(profile.data?.ai_notes === trainingNotes).toBe(true);
  const ids: NativeIds = {
    userId: account.userId, planId: created.plan.id, workoutIds: created.workouts.map((row) => row.id),
    sessionId: completed.session_id, cardioId: completed.cardio_log_id,
  };
  const rows = await nativeRows(account.client, ids);
  expect(rows.sessions[0].completed_at !== null).toBe(true);
  expect(isDeepStrictEqual(rows.cardio_logs[0].swim_result, result)).toBe(true);
  expect(rows.cardio_logs[0].notes === notes).toBe(true);
  return { ...ids, rows, result, notes, trainingNotes, receiptId };
}

type NativeFixture = Awaited<ReturnType<typeof arrangeNative>>;
type ExportPayload = Record<string, unknown> & {
  user: { id: string }; profile: Record<string, unknown> & { id: string };
  swim_plans: Row[]; swim_workouts: Row[]; sessions: Row[]; cardio_logs: Row[];
};

async function accountPage(page: Page, account: Account) {
  await page.goto("/app/settings/account");
  await expect(page).toHaveURL(/\/app\/settings\/account$/);
  await expect(page.getByRole("heading", { name: "Account & data", exact: true })).toBeVisible();
  // Keep email values out of assertion diagnostics.
  expect(await page.locator("main p.font-mono").textContent() === account.email).toBe(true);
}

async function exportFromAccount(page: Page, account: Account): Promise<ExportPayload> {
  await accountPage(page, account);
  const href = await page.getByRole("link", { name: "Export my data (JSON)", exact: true }).getAttribute("href");
  expect(href === "/api/me/export").toBe(true);
  // Never click the download anchor: the signed-in context holds JSON in memory.
  const response = await page.context().request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]?.includes("application/json")).toBe(true);
  expect(response.headers()["cache-control"] === "no-store, max-age=0").toBe(true);
  const body = await response.json() as ExportPayload;
  expect(body.schema === "hybrid-training-app/export-v2").toBe(true);
  expect(body.format_version === 2).toBe(true);
  expect(body.swimming_schema_available === true).toBe(true);
  expect(body.user.id).toBe(account.userId);
  expect(body.profile.id).toBe(account.userId);
  await response.dispose();
  return body;
}

function assertNativeExport(body: ExportPayload, own: NativeFixture, other: NativeFixture) {
  for (const section of ["swim_plans", "swim_workouts", "sessions", "cardio_logs"] as const) {
    const exported = body[section];
    const expected = own.rows[section];
    expect(Array.isArray(exported)).toBe(true);
    expect(exported.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    for (const saved of expected) {
      const row = exported.find((candidate) => candidate.id === saved.id)!;
      // Cardio exports add a catalog join; every persisted field must still match.
      expect(Object.entries(saved).every(([key, value]) => isDeepStrictEqual(row[key], value))).toBe(true);
    }
  }
  expect(body.profile.training_notes === own.trainingNotes).toBe(true);
  for (const key of ["ai_notes", "byoai_provider", "byoai_key_vault_id", "byoai_model", "byoai_unlocked_at"]) {
    // Key absence is an invariant, not proof of stripping a populated vault secret.
    expect(Object.hasOwn(body.profile, key)).toBe(false);
  }
  const serialized = JSON.stringify(body);
  for (const sentinel of [
    other.userId, other.planId, ...other.workoutIds, other.sessionId, other.cardioId,
    other.notes, other.trainingNotes, other.receiptId,
  ]) {
    expect(serialized.includes(sentinel)).toBe(false);
  }
}

test.describe("ADR0079 mobile swimming account acceptance", () => {
  test.use(mobile);
  test.skip(!swimE2EEnabled(process.env), "Blocked: swimming E2E was not explicitly requested.");

  test("C1 DC-SW1/DC-SW8: Account exports native records and isolates synthetic users", async ({
    page, context, browser, accounts: [primary, other], seedConfig, baseURL,
  }) => {
    const own = await arrangeNative(primary, "yd");
    const foreign = await arrangeNative(other, "m");
    await signInAs(context, primary, seedConfig, baseURL!);
    assertNativeExport(await exportFromAccount(page, primary), own, foreign);

    const otherContext = await browser.newContext({ ...mobile, baseURL, storageState: { cookies: [], origins: [] } });
    try {
      await signInAs(otherContext, other, seedConfig, baseURL!);
      assertNativeExport(await exportFromAccount(await otherContext.newPage(), other), foreign, own);
    } finally {
      await otherContext.close();
    }
    const anonymous = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      expect((await anonymous.cookies()).length).toBe(0);
      const response = await anonymous.request.get("/api/me/export");
      expect(response.status()).toBe(401);
      await response.dispose();
    } finally {
      await anonymous.close();
    }
  });
});
