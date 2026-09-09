import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Page, Request, Response as PlaywrightResponse } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NewMovement, NewSession, NewSessionMovement, NewSetLog } from "@hta/db";
import type { SwimActualResult, SwimSetup } from "@hta/domain";
import { generateSwimPlan, SWIM_GENERATOR_VERSION } from "@hta/engine";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { addDaysToYmd } from "../src/lib/dates";
import { alertAnnotation, authAbsenceBackend, c2HttpClass, c2Location, c2Transport, unavailableAlert, type C2HttpClass } from "../scripts/swim-alert-membership";
import {
  standaloneWeekRequests, type StandalonePlanDefinition, type StandaloneWorkoutDefinition,
} from "../src/lib/swim/model";
import {
  createSwimPlan, startSwimWorkout, completeSwimWorkout,
  type SwimWorkoutInput,
} from "../src/lib/swim/storage";

const mobile = { viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true };
type Row = Record<string, unknown> & { id: string };
type CustomIds = { movementId: string; sessionId: string; setId: string };
type Account = {
  email: string; password: string; userId: string; client: SupabaseClient;
  custom?: CustomIds;
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
  if (account.custom) {
    const { movementId, sessionId, setId } = account.custom;
    const session = await admin.from("sessions").select("id, user_id").eq("id", sessionId).maybeSingle();
    const movement = await admin.from("movements").select("id, user_id").eq("id", movementId).maybeSingle();
    expect(session.error === null && movement.error === null).toBe(true);
    expect(!session.data || session.data.user_id === account.userId).toBe(true);
    expect(!movement.data || movement.data.user_id === account.userId).toBe(true);
    // Teardown only: never remove either RESTRICT reference before Account deletion.
    // Exact allocated IDs also cover a partially failed fixture arrangement.
    const sets = await admin.from("set_logs").delete().eq("id", setId)
      .eq("session_id", sessionId).eq("movement_id", movementId);
    expect(sets.error === null).toBe(true);
    const links = await admin.from("session_movements").delete().eq("user_id", account.userId)
      .eq("session_id", sessionId).eq("movement_id", movementId);
    expect(links.error === null).toBe(true);
    const removedSession = await admin.from("sessions").delete().eq("user_id", account.userId).eq("id", sessionId);
    expect(removedSession.error === null).toBe(true);
    const removedMovement = await admin.from("movements").delete().eq("user_id", account.userId).eq("id", movementId);
    expect(removedMovement.error === null).toBe(true);
    await assertCustomGone(admin, account.userId, account.custom);
  }
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
  expect(isDeepStrictEqual(created.plan.definition, definition)).toBe(true);
  expect(created.workouts.length).toBe(4);
  for (const saved of created.workouts) {
    const expected = workouts.find((row) => row.scheduled_date === saved.scheduled_date && row.slot === saved.slot);
    expect(saved.user_id).toBe(account.userId);
    expect(saved.plan_id).toBe(created.plan.id);
    expect(isDeepStrictEqual(saved.definition, expected?.definition)).toBe(true);
  }
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
  expect(typeof rows.sessions[0].completed_at === "string").toBe(true);
  expect(rows.sessions[0].deleted_at === null).toBe(true);
  expect(rows.cardio_logs[0].modality === "swimming").toBe(true);
  expect(isDeepStrictEqual(rows.cardio_logs[0].swim_result, result)).toBe(true);
  expect(rows.cardio_logs[0].notes === notes).toBe(true);
  return { ...ids, rows, result, notes, trainingNotes, receiptId };
}

type NativeFixture = Awaited<ReturnType<typeof arrangeNative>>;

async function arrangeReferencedCustomMovement(account: Account) {
  const ids: CustomIds = { movementId: randomUUID(), sessionId: randomUUID(), setId: randomUUID() };
  account.custom = ids;
  const movement: NewMovement = {
    id: ids.movementId, userId: account.userId,
    slug: `synthetic-account-row-${ids.movementId}`, displayName: `Synthetic row ${ids.movementId}`,
    pattern: "pull", primaryRegion: "shoulder_scapular", primaryMuscles: ["lats", "mid_back"],
    equipment: "dumbbells-incline-bench", isCompound: true, isSupported: true, stability: "supported",
  };
  const insertedMovement = await account.client.from("movements").insert({
    id: movement.id, user_id: movement.userId, slug: movement.slug, display_name: movement.displayName,
    pattern: movement.pattern, primary_region: movement.primaryRegion, primary_muscles: movement.primaryMuscles,
    equipment: movement.equipment, is_compound: movement.isCompound, is_supported: movement.isSupported,
    stability: movement.stability,
  }).select("id, user_id").single();
  expect(insertedMovement.error === null).toBe(true);
  expect(insertedMovement.data?.id).toBe(ids.movementId);
  expect(insertedMovement.data?.user_id).toBe(account.userId);

  const session: NewSession = {
    id: ids.sessionId, userId: account.userId, title: `Synthetic strength ${ids.sessionId}`, slot: "single",
  };
  const insertedSession = await account.client.from("sessions").insert({
    id: session.id, user_id: session.userId, title: session.title, slot: session.slot,
  }).select("id, user_id").single();
  expect(insertedSession.error === null).toBe(true);
  expect(insertedSession.data?.id).toBe(ids.sessionId);
  expect(insertedSession.data?.user_id).toBe(account.userId);

  const link: NewSessionMovement = {
    sessionId: ids.sessionId, movementId: ids.movementId, userId: account.userId, sortOrder: 0,
  };
  const insertedLink = await account.client.from("session_movements").insert({
    session_id: link.sessionId, movement_id: link.movementId, user_id: link.userId, sort_order: link.sortOrder,
  }).select("session_id, movement_id, user_id").single();
  expect(insertedLink.error === null).toBe(true);
  expect(insertedLink.data?.session_id).toBe(ids.sessionId);
  expect(insertedLink.data?.movement_id).toBe(ids.movementId);
  expect(insertedLink.data?.user_id).toBe(account.userId);

  const set: NewSetLog = {
    id: ids.setId, sessionId: ids.sessionId, movementId: ids.movementId,
    setIndex: 0, setKind: "main", reps: 8, weightKg: "12.00", rpe: "6.0",
  };
  const insertedSet = await account.client.from("set_logs").insert({
    id: set.id, session_id: set.sessionId, movement_id: set.movementId,
    set_index: set.setIndex, set_kind: set.setKind, reps: set.reps, weight_kg: set.weightKg, rpe: set.rpe,
  }).select("id, session_id, movement_id").single();
  expect(insertedSet.error === null).toBe(true);
  expect(insertedSet.data?.id).toBe(ids.setId);
  expect(insertedSet.data?.session_id).toBe(ids.sessionId);
  expect(insertedSet.data?.movement_id).toBe(ids.movementId);
  const swimLinks = await account.client.from("swim_workouts").select("id")
    .eq("user_id", account.userId).eq("session_id", ids.sessionId);
  expect(swimLinks.error === null).toBe(true);
  expect(swimLinks.data?.length).toBe(0);
  return ids;
}

async function assertCustomGone(admin: SupabaseClient, userId: string, ids: CustomIds) {
  const results = await Promise.all([
    admin.from("movements").select("id").eq("user_id", userId).eq("id", ids.movementId),
    admin.from("sessions").select("id").eq("user_id", userId).eq("id", ids.sessionId),
    admin.from("set_logs").select("id").eq("session_id", ids.sessionId)
      .eq("movement_id", ids.movementId).eq("id", ids.setId),
    admin.from("session_movements").select("session_id").eq("user_id", userId)
      .eq("session_id", ids.sessionId).eq("movement_id", ids.movementId),
  ]);
  for (const result of results) {
    expect(result.error === null).toBe(true);
    expect(result.data?.length).toBe(0);
  }
}

async function assertNativeGone(admin: SupabaseClient, ids: NativeIds) {
  const results = await Promise.all([
    admin.from("profiles").select("id").eq("id", ids.userId),
    admin.from("swim_plans").select("id").eq("user_id", ids.userId).eq("id", ids.planId),
    admin.from("swim_workouts").select("id").eq("user_id", ids.userId).in("id", ids.workoutIds),
    admin.from("sessions").select("id").eq("user_id", ids.userId).eq("id", ids.sessionId),
    admin.from("cardio_logs").select("id").eq("session_id", ids.sessionId).eq("id", ids.cardioId),
  ]);
  for (const result of results) {
    expect(result.error === null).toBe(true);
    expect(result.data?.length).toBe(0);
  }
}

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

// Generic collection must not write account/export artifacts on a retry either.
test.use({ ...mobile, trace: "off", screenshot: "off", video: "off" });

test.describe("ADR0079 mobile swimming account acceptance", () => {
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

  test("C2 DC-SW8: Account deletion cascades with a referenced user-owned custom movement and preserves a survivor", async ({
    page, context, browser, accounts: [primary, survivor], seedConfig, admin, baseURL,
  }, testInfo) => {
    // Named positive regression for A1's auth-deletion cleanup failure:
    // 0001/0003 cascade from auth.users; set_logs and 0059 session_movements
    // RESTRICT movement deletion. The observed code/order is not proved.
    // No expected failure, global-movement substitute or pre-deletion cleanup.
    const own = await arrangeNative(primary, "yd");
    const kept = await arrangeNative(survivor, "m");
    const custom = await arrangeReferencedCustomMovement(primary);
    expect(custom.sessionId).not.toBe(own.sessionId);
    await signInAs(context, primary, seedConfig, baseURL!);
    const survivorContext = await browser.newContext({ ...mobile, baseURL, storageState: { cookies: [], origins: [] } });
    try {
      await signInAs(survivorContext, survivor, seedConfig, baseURL!);
      const survivorPage = await survivorContext.newPage();
      const before = await exportFromAccount(survivorPage, survivor);
      assertNativeExport(before, kept, own);

      await accountPage(page, primary);
      let matchedRequest: Request | null = null;
      let matchCount = 0;
      let statusClass: C2HttpClass | null = null;
      let failed = false;
      let invalid = false;
      let expectedAccountURL: string | undefined;
      try { expectedAccountURL = new URL("/app/settings/account", baseURL!).href; }
      catch { invalid = true; }
      const matches = (request: Request) => {
        const method = request.method();
        if (typeof method !== "string") { invalid = true; return false; }
        if (method !== "POST") return false;
        const url = request.url();
        if (typeof url !== "string" || !URL.canParse(url)) { invalid = true; return false; }
        return expectedAccountURL !== undefined && url === expectedAccountURL;
      };
      const onRequest = (request: Request) => {
        try {
          if (!matches(request)) return;
          matchCount = Math.min(matchCount + 1, 2);
          if (matchCount !== 1) { invalid = true; return; }
          matchedRequest = request;
        } catch { invalid = true; }
      };
      const onResponse = (response: PlaywrightResponse) => {
        try {
          const request = response.request();
          if (request !== matchedRequest) {
            if (matches(request)) invalid = true;
            return;
          }
          const observed = c2HttpClass(response.status());
          if (observed === "unavailable" || statusClass !== null) { invalid = true; return; }
          statusClass = observed;
        } catch { invalid = true; }
      };
      const onRequestFailed = (request: Request) => {
        try {
          if (request === matchedRequest) failed = true;
          else if (matches(request)) invalid = true;
        } catch { invalid = true; }
      };
      try {
        try { page.on("request", onRequest); } catch { invalid = true; }
        try { page.on("response", onResponse); } catch { invalid = true; }
        try { page.on("requestfailed", onRequestFailed); } catch { invalid = true; }
        await page.getByRole("button", { name: "Delete account (GDPR Art. 17)", exact: true }).click();
        try {
          await expect(page).toHaveURL(new URL("/?deleted=1", baseURL!).href);
        } catch (error) {
          try {
            const diagnostic = unavailableAlert("c2-auth-absence");
            const controller = new AbortController();
            const deadline = performance.now() + 1000;
            const interrupted = () => testInfo.status === "timedOut" ||
              testInfo.status === "interrupted" || page.isClosed();
            const active = () => !controller.signal.aborted && !interrupted() && performance.now() < deadline;
            const expiry = setTimeout(() => controller.abort(), 1000);
            try {
              if (active()) {
                const observer = createClient(seedConfig.supabaseUrl, seedConfig.serviceRoleKey, {
                  auth: { persistSession: false, autoRefreshToken: false },
                  global: { fetch: async (input, init) => {
                    try { return await fetch(input, { ...init, signal: controller.signal }); }
                    // The SDK logs rejected fetch errors; expose only an unavailable response.
                    catch { return new Response(null, { status: 503 }); }
                  } },
                });
                const sample = await observer.auth.admin.getUserById(primary.userId);
                if (active()) diagnostic.backend = authAbsenceBackend(sample.data.user, sample.error, primary.userId);
                if (diagnostic.backend === "not-reached" && active()) {
                  try { diagnostic.control = c2Location(page.url(), baseURL); }
                  catch { diagnostic.control = "unavailable"; }
                  diagnostic.result = c2Transport(matchCount, statusClass, failed, invalid);
                }
              }
            } catch {
              diagnostic.backend = "unavailable";
            } finally {
              controller.abort();
              clearTimeout(expiry);
            }
            if (interrupted() || performance.now() >= deadline) diagnostic.backend = "unavailable";
            if (diagnostic.backend !== "not-reached") {
              diagnostic.control = "unavailable";
              diagnostic.result = "unavailable";
            }
            const annotation = alertAnnotation(diagnostic);
            if (annotation) testInfo.annotations.push(annotation);
          } catch {
            // Observation or annotation failure must never replace the original URL assertion.
          }
          throw error;
        }
      } finally {
        try { page.off("request", onRequest); } catch { /* Preserve the original outcome. */ }
        try { page.off("response", onResponse); } catch { /* Preserve the original outcome. */ }
        try { page.off("requestfailed", onRequestFailed); } catch { /* Preserve the original outcome. */ }
      }
      expect((await context.cookies()).filter((cookie) =>
        /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name) && cookie.value !== "").length).toBe(0);

      // Product deletion is proved before teardown, through the harness admin,
      // never through dead primary cookies or redirect alone.
      const deleted = await admin.auth.admin.getUserById(primary.userId);
      expect(deleted.data.user === null).toBe(true);
      expect(deleted.error?.status).toBe(404);
      await assertNativeGone(admin, own);
      await assertCustomGone(admin, primary.userId, custom);

      const survivingUser = await admin.auth.admin.getUserById(survivor.userId);
      expect(survivingUser.error === null).toBe(true);
      expect(survivingUser.data.user?.id).toBe(survivor.userId);
      expect(survivingUser.data.user?.email === survivor.email).toBe(true);
      expect(isDeepStrictEqual(await nativeRows(admin, kept), kept.rows)).toBe(true);
      const after = await exportFromAccount(survivorPage, survivor);
      assertNativeExport(after, kept, own);
      expect(isDeepStrictEqual(after.profile, before.profile)).toBe(true);
      const serialized = JSON.stringify(after);
      for (const id of [custom.sessionId, custom.movementId, custom.setId]) {
        expect(serialized.includes(id)).toBe(false);
      }
      const workout = kept.rows.swim_workouts.find((row) => row.session_id === kept.sessionId)!;
      await survivorPage.goto(`/app/swim/${workout.id}`);
      await expect(survivorPage).toHaveURL(new URL(`/app/swim/${workout.id}`, baseURL!).href);
      await expect(survivorPage.getByRole("heading", { name: "Your swim", exact: true })).toBeVisible();
      expect(isDeepStrictEqual(await nativeRows(admin, kept), kept.rows)).toBe(true);
    } finally {
      await survivorContext.close();
    }
  });

  test("C3 DC-SW8: Auth admin deletes native and custom-linked synthetic accounts without the app action", async ({
    accounts: [control, linked], admin,
  }) => {
    const native = await arrangeNative(control, "yd");
    const referenced = await arrangeNative(linked, "yd");
    const custom = await arrangeReferencedCustomMovement(linked);
    expect(custom.sessionId).not.toBe(referenced.sessionId);
    expect(isDeepStrictEqual(await nativeRows(admin, native), native.rows)).toBe(true);
    expect(isDeepStrictEqual(await nativeRows(admin, referenced), referenced.rows)).toBe(true);
    const profiles = await Promise.all([control, linked].map((account) =>
      admin.from("profiles").select("*").eq("id", account.userId).single()));
    for (const [index, profile] of profiles.entries()) {
      expect(profile.error === null).toBe(true);
      expect(profile.data?.id === [control.userId, linked.userId][index]).toBe(true);
    }
    const readCustom = async () => {
      const results = await Promise.all([
        admin.from("movements").select("*").eq("user_id", linked.userId).eq("id", custom.movementId).single(),
        admin.from("sessions").select("*").eq("user_id", linked.userId).eq("id", custom.sessionId).single(),
        admin.from("set_logs").select("*").eq("id", custom.setId)
          .eq("session_id", custom.sessionId).eq("movement_id", custom.movementId).single(),
        admin.from("session_movements").select("*").eq("user_id", linked.userId)
          .eq("session_id", custom.sessionId).eq("movement_id", custom.movementId).single(),
      ]);
      for (const result of results) {
        expect(result.error === null).toBe(true);
        expect(result.data !== null).toBe(true);
      }
      return results.map((result) => result.data);
    };
    const customBefore = await readCustom();

    const absentMovement = randomUUID();
    const orphanSet = randomUUID();
    const absent = await admin.from("movements").select("id").eq("id", absentMovement);
    expect(absent.error === null).toBe(true);
    expect(absent.data?.length).toBe(0);
    // Await each PostgREST request: deferred violations surface at transaction end.
    const rejected = [
      () => linked.client.from("movements").delete().eq("user_id", linked.userId).eq("id", custom.movementId),
      () => linked.client.from("set_logs").insert({
        id: orphanSet, session_id: custom.sessionId, movement_id: absentMovement,
        set_index: 1, set_kind: "main", reps: 8, weight_kg: 12, rpe: 6,
      }),
      () => linked.client.from("session_movements").insert({
        session_id: custom.sessionId, movement_id: absentMovement, user_id: linked.userId, sort_order: 1,
      }),
      () => linked.client.from("set_logs").update({ movement_id: absentMovement })
        .eq("id", custom.setId).eq("session_id", custom.sessionId).eq("movement_id", custom.movementId),
      () => linked.client.from("session_movements").update({ movement_id: absentMovement })
        .eq("user_id", linked.userId).eq("session_id", custom.sessionId).eq("movement_id", custom.movementId),
    ];
    for (const request of rejected) {
      expect((await request()).error?.code).toBe("23503");
      expect(isDeepStrictEqual(await readCustom(), customBefore)).toBe(true);
      const orphans = await Promise.all([
        linked.client.from("set_logs").select("id").eq("id", orphanSet),
        linked.client.from("session_movements").select("session_id")
          .eq("session_id", custom.sessionId).eq("movement_id", absentMovement),
      ]);
      for (const orphan of orphans) {
        expect(orphan.error === null).toBe(true);
        expect(orphan.data?.length).toBe(0);
      }
    }

    const controlDeletion = await admin.auth.admin.deleteUser(control.userId);
    expect(controlDeletion.error?.status !== undefined && controlDeletion.error.status >= 500 && controlDeletion.error.status < 600).toBe(false);
    expect(controlDeletion.error === null).toBe(true);
    const controlAfter = await admin.auth.admin.getUserById(control.userId);
    expect(controlAfter.data.user === null).toBe(true);
    expect(controlAfter.error?.status).toBe(404);
    await assertNativeGone(admin, native);

    const linkedUser = await admin.auth.admin.getUserById(linked.userId);
    expect(linkedUser.error === null).toBe(true);
    expect(linkedUser.data.user?.id === linked.userId).toBe(true);
    expect(linkedUser.data.user?.email === linked.email).toBe(true);
    expect(isDeepStrictEqual(await nativeRows(admin, referenced), referenced.rows)).toBe(true);
    const linkedProfile = await admin.from("profiles").select("*").eq("id", linked.userId).single();
    expect(linkedProfile.error === null).toBe(true);
    expect(isDeepStrictEqual(linkedProfile.data, profiles[1].data)).toBe(true);
    expect(isDeepStrictEqual(await readCustom(), customBefore)).toBe(true);

    const linkedDeletion = await admin.auth.admin.deleteUser(linked.userId);
    expect(linkedDeletion.error?.status !== undefined && linkedDeletion.error.status >= 500 && linkedDeletion.error.status < 600).toBe(false);
    expect(linkedDeletion.error === null).toBe(true);
    const linkedAfter = await admin.auth.admin.getUserById(linked.userId);
    expect(linkedAfter.data.user === null).toBe(true);
    expect(linkedAfter.error?.status).toBe(404);
    await assertNativeGone(admin, referenced);
    await assertCustomGone(admin, linked.userId, custom);
  });
});
