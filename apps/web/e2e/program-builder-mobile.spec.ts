import { openSwimProgramActions } from "./fixtures/swim-navigation";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Locator, Page, Request, Response } from "@playwright/test";
import type { Prescription } from "@hta/db";
import { tacticalBarbellEngine } from "@hta/tacticalbarbell";
import { greenProtocolEngine, getGreenPhase } from "@hta/green";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { syntheticCourse } from "../src/lib/swim/__tests__/course-fixtures";
import { addDaysToYmd } from "../src/lib/dates";
import { classifyHistoryDeleteFailure, nativeUiFailureSchema, unavailableNativeUi,
  type NativeUiFailure, type MODULAR_STAGE_CODES } from "../scripts/modular-browser-observations";
import { importOutcomeColumns, importOutcomeSchema } from "../src/lib/swim/import-outcomes";
import { matchColumns, matchSchema } from "../src/lib/swim/import-matching";
import { standaloneOutcomeExportSchema, standaloneOutcomeNativeQueries } from "./fixtures/standalone-outcomes";
import { readModularLegacyFixture, legacyGraphSnapshot, type ModularLegacyFixture } from "./fixtures/modular-legacy";
import { nativeProgramDefinition, prepareNativeCourse, prepareNativeProgram, nativeTemplateInput,
  nativeScheduleCommit, prepareNativeMeasurements, readNativeOutbox } from "./fixtures/modular-programs";
import { groupPrescriptionByMovement } from "../src/lib/sessions/movement-grouping";

type Movement = { id: string; slug: string; display_name: string };
type Planned = { id: string; block_id: string; week_index: number; day_index: number;
  prescription: Prescription; completed_session_id: string | null };
const today = () => new Date().toISOString().slice(0, 10);
const weekday = () => (new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7;

const test = seededTest.extend<{ actor: SupabaseClient; catalog: Movement[] }>({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks. */
  seedConfig: async ({ baseURL }, use) => {
    if (!swimE2EEnabled(process.env) || process.env.E2E_SWIM_LOCAL !== "1") {
      throw new Error("Modular acceptance requires dedicated disposable loopback storage.");
    }
    if (!baseURL || process.env.PLAYWRIGHT_BASE_URL !== baseURL) throw new Error("Explicit local app origin required.");
    const target = new URL(baseURL);
    if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
      throw new Error("Loopback app origin required.");
    }
    const { E2E_SUPABASE_URL: supabaseUrl, E2E_SUPABASE_ANON_KEY: anonKey,
      E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } = process.env;
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Explicit disposable seed configuration required.");
    await use({ supabaseUrl, anonKey, serviceRoleKey });
  },
  freshUser: async ({ admin }, use) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`, password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    if (!created.data.user) throw new Error("Synthetic user missing.");
    const userId = created.data.user.id;
    try { await use({ email, password, userId }); }
    finally { await nativeTeardown(async () => {
      const removed = await admin.auth.admin.deleteUser(userId);
      expect(removed.error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user).toBeNull();
      expect(remaining.error?.status).toBe(404);
    }); }
  },
  actor: async ({ admin, freshUser, seedConfig, context, baseURL }, use) => {
    await markOnboarded(admin, freshUser.userId);
    const profile = await admin.from("profiles").update({ timezone: "UTC" }).eq("id", freshUser.userId);
    expect(profile.error).toBeNull();
    await signInAs(context, freshUser, seedConfig, baseURL!);
    const client = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signed = await client.auth.signInWithPassword(freshUser);
    expect(signed.error).toBeNull();
    await use(client);
  },
  catalog: async ({ actor }, use) => {
    const result = await actor.from("movements").select("id,slug,display_name")
      .in("slug", ["bench-press-flat", "goblet-squat", "run-easy-z2"]).is("user_id", null).returns<Movement[]>();
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(3);
    await use(result.data!);
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

const ownedTest = test.extend({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks. */
  freshUser: async ({ admin, seedConfig }, use) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`, password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const userId = z.string().uuid().parse(created.data.user?.id);
    const owner = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
      await use({ email, password, userId });
    } finally { await nativeTeardown(async () => {
      expect((await admin.auth.admin.deleteUser(userId)).error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user).toBeNull(); expect(remaining.error?.status).toBe(404);
      for (const table of ["training_blocks", "program_instances", "planned_sessions", "sessions", "training_maxes",
        "program_recommendations", "rehab_protocols", "program_rehab_bindings", "swim_plan_rehab_bindings",
        "swim_plans", "swim_workouts", "training_seasons", "season_blocks", "engine_override_events"]) {
        const result = await owner.from(table).select("user_id").eq("user_id", userId);
        expect(result.error, table).toBeNull(); expect(result.data, table).toEqual([]);
      }
    }); }
  },
  actor: async ({ freshUser, seedConfig, context, baseURL }, use) => {
    const client = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(freshUser)).error).toBeNull();
    await markOnboarded(client, freshUser.userId);
    const profile = await client.from("profiles").update({ timezone: "UTC" })
      .eq("id", freshUser.userId).select("id").single();
    expect(profile.error).toBeNull(); expect(profile.data?.id).toBe(freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL!);
    await use(client);
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});
const legacyTest = ownedTest.extend<{ legacy: ModularLegacyFixture }>({
  /* eslint-disable react-hooks/rules-of-hooks -- Playwright fixture callbacks. */
  legacy: async ({}, use) => { await use(readModularLegacyFixture()); },
  freshUser: async ({ legacy }, use) => {
    // The runner owns this pre-migration account and verifies cleanup after the browser.
    try { await use({ email: legacy.email, password: legacy.password, userId: legacy.userId }); }
    finally { if (test.info().status !== "passed") failurePhase("test"); }
  },
  /* eslint-enable react-hooks/rules-of-hooks */
});

function diagnosticAnnotation(type: "modular-stage" | "modular-set-indices" | "modular-failure-phase" | "history-delete-failure" | "native-ui-failure", description: string) {
  const annotations = test.info().annotations;
  const existing = annotations.find((annotation) => annotation.type === type);
  if (existing) existing.description = description;
  else annotations.push({ type, description });
}
function stage(code: (typeof MODULAR_STAGE_CODES)[keyof typeof MODULAR_STAGE_CODES][number]) {
  diagnosticAnnotation("modular-stage", code);
}

function failurePhase(phase: "test" | "teardown") {
  const previous = test.info().annotations.find((annotation) => annotation.type === "modular-failure-phase")?.description;
  diagnosticAnnotation("modular-failure-phase", previous && previous !== phase ? "test-and-teardown" : phase);
}

async function nativeTeardown(work: () => Promise<void>) {
  if (test.info().status !== "passed" &&
    !test.info().annotations.some((annotation) => annotation.type === "modular-failure-phase")) failurePhase("test");
  try { await work(); }
  catch (error) { failurePhase("teardown"); throw error; }
}

function observeNativeUi(
  page: Page, caseId: NativeUiFailure["case"], target: string,
  readRecord: () => Promise<NativeUiFailure["record"]>,
  date?: string,
) {
  let state = unavailableNativeUi(caseId);
  state.request = "not-observed";
  let navigationStatus = 0;
  const pending = new Set<Request>();
  const publish = () => diagnosticAnnotation("native-ui-failure", JSON.stringify(state));
  const action = (request: Request) => request.method() === "POST" &&
    new URL(request.url()).origin === new URL(page.url()).origin &&
    new URL(request.url()).pathname === (caseId === "m8" ? "/app/plan" :
      caseId === "m11" ? "/app/plan/history" : "/app/settings/rehab-protocols") &&
    !!request.headers()["next-action"];
  const requested = (request: Request) => {
    if (!action(request)) return;
    pending.add(request); state.request = "pending"; publish();
  };
  const responded = (response: Response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationStatus = response.status();
    if (!pending.delete(request)) return;
    state.request = pending.size ? "pending" : response.ok() ? "http-success" : "http-failure";
    publish();
  };
  const failed = (request: Request) => {
    if (!pending.delete(request)) return;
    state.request = pending.size ? "pending" : "transport-failure"; publish();
  };
  page.on("request", requested); page.on("response", responded); page.on("requestfailed", failed);
  publish();
  const capture = async () => {
    try {
      const ui = await page.evaluate(({ caseId, target, navigationStatus, date }): NativeUiFailure => {
        const visible = (element: Element | null) => !!element?.getClientRects().length;
        if (caseId === "m8") {
          const control = visible(document.querySelector('[data-testid="end-block-confirm"]')) ? "dialog" :
            visible(document.querySelector('[data-testid="program-actions-menu"]')) ? "menu" :
              visible(document.querySelector('[data-testid="program-actions-more"]')) ? "more" : "absent";
          const errorPage = !!document.querySelector("#__next_error__") ||
            [...document.querySelectorAll("h1,h2")].some((heading) =>
              visible(heading) && /^Application error:/i.test(heading.textContent?.trim() ?? ""));
          const pageState = navigationStatus === 404 ? "not-found" :
            navigationStatus >= 500 || document.title.startsWith("Application error") || errorPage ? "error" :
              location.pathname.startsWith("/login") || location.pathname.startsWith("/auth") ? "auth" :
                location.pathname === "/app/plan" &&
                  !visible(document.querySelector('[data-testid="offline-document"]')) &&
                  visible(document.querySelector('[data-testid="plan-redesign"]')) ? "plan" : "other";
          return { case: "m8", page: pageState, control, request: "unavailable", record: "unavailable" };
        }
        if (caseId === "m11") {
          if (date) {
            const week = document.querySelector('section[aria-label="This week"]');
            const days = week?.querySelectorAll(`time[datetime="${date}"]`);
            const day = days?.[0]?.parentElement?.parentElement;
            const link = `a[href="/app/sessions/start/${target}"]`;
            const count = (value: number | undefined) => !value ? "none" : value === 1 ? "one" : "multiple";
            return { case: "m11", control: week ? "schedule" : "schedule-absent",
              request: "unavailable", record: "unavailable", calendar: {
                day: count(days?.length), weekLink: count(week?.querySelectorAll(link).length),
                dayLink: count(day?.querySelectorAll(link).length),
              } };
          }
          const row = document.querySelector(`[data-testid="block-history-row"][data-block-id="${target}"]`);
          const menu = row?.querySelector('[data-testid="block-actions-menu"]');
          const submit = menu?.querySelector<HTMLButtonElement>('[data-testid="delete-block-menu-item"]');
          const control = !row ? "row-absent" : submit?.disabled ? "pending" :
            visible(menu?.querySelector("p") ?? null) ? "error" : visible(menu ?? null) ? "menu-open" : "menu-closed";
          return { case: "m11", control, request: "unavailable", record: "unavailable" };
        }
        const submit = document.querySelector<HTMLButtonElement>('[data-testid="rehab-protocol-save"]');
        const control = submit?.disabled ? "pending" :
          visible(document.querySelector('[data-testid="rehab-protocol-error"],[aria-invalid="true"]')) ? "error" :
            submit?.form?.querySelector(":invalid") ? "invalid" : submit ? "editor" :
              visible(document.querySelector('[data-testid="rehab-protocol-new"]')) ? "library" : "empty";
        return { case: caseId, control, request: "unavailable", record: "unavailable" };
      }, { caseId, target, navigationStatus, date });
      state = nativeUiFailureSchema.parse({ ...ui, request: state.request, record: state.record });
      publish();
    } catch {
      // Timeout teardown can close the page; keep the last observable enum snapshot.
      publish();
    }
  };
  return {
    capture,
    async recordFailure() {
      await capture();
      try { state = nativeUiFailureSchema.parse({ ...state, record: await readRecord() }); }
      catch { state.record = "unavailable"; }
      publish();
    },
    dispose() {
      page.off("request", requested); page.off("response", responded); page.off("requestfailed", failed);
    },
  };
}

function movement(catalog: Movement[], slug: string) {
  const selected = catalog.find((row) => row.slug === slug);
  if (!selected) throw new Error("Required library fixture missing.");
  return selected;
}
async function begin(page: Page, activity: string, name: string) {
  await page.goto(`/app/program/build?activity=${activity}`);
  await page.getByLabel("Program name", { exact: true }).fill(name);
  await page.getByLabel("Weeks", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add workout", exact: true }).nth(weekday()).click();
  await page.getByLabel("Workout name", { exact: true }).fill(`${name} workout`);
}
async function pick(scope: Page | Locator, selected: Movement) {
  await scope.getByLabel("Search library", { exact: true }).fill(selected.display_name);
  await scope.getByRole("button", { name: selected.display_name, exact: true }).click();
}
async function lift(page: Page, selected: Movement) {
  await page.getByRole("button", { name: "Add exercise", exact: true }).click();
  const part = page.locator("article").last();
  await pick(part, selected);
  await part.getByLabel("Sets", { exact: true }).fill("1");
  await part.getByLabel("Load (kg)", { exact: true }).fill("20");
  await part.getByLabel("Rest (seconds)", { exact: true }).fill("0");
}
async function run(page: Page, selected: Movement, activity = "running") {
  await page.getByRole("button", { name: activity === "running" ? "Add run" : "Add cardio", exact: true }).click();
  const part = page.locator("article").last();
  await pick(part, selected);
  await part.getByLabel("Seconds", { exact: true }).fill("60");
  await part.getByLabel("Repeat sequence", { exact: true }).fill("2");
}
async function review(page: Page, timeout?: number) {
  await page.getByRole("button", { name: "Review program", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start program", exact: true })).toBeVisible({ timeout });
}
async function save(page: Page, actor: SupabaseClient, kind: "strength" | "running" | "hybrid", timeout?: number, replacement?: string) {
  const submit = page.getByRole("button", { name: /^(Start program|Save changes)$/ });
  await expect(submit).toBeVisible({ timeout });
  expect(await submit.isEnabled(), "Program save is disabled; accept the required overlap or replacement consent before saving.").toBe(true);
  await submit.click();
  if (replacement) {
    const confirmation = page.getByRole("dialog", { name: `Replace ${replacement}?`, exact: true });
    await expect(confirmation).toBeVisible({ timeout });
    await confirmation.getByRole("button", { name: "Replace program", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/app\/plan\?block=[0-9a-f-]{36}$/, { timeout });
  const saved = await actor.from("training_blocks").select("id").eq("program_kind", kind)
    .eq("status", "active").is("deleted_at", null).single();
  expect(saved.error).toBeNull();
  const id = z.string().uuid().parse(saved.data?.id);
  await expect(page).toHaveURL(new RegExp(`/app/plan\\?block=${id}$`), { timeout });
  return id;
}
async function planned(actor: SupabaseClient) {
  const result = await actor.from("planned_sessions")
    .select("id,block_id,week_index,day_index,prescription,completed_session_id")
    .order("week_index").order("day_index").order("id").returns<Planned[]>();
  expect(result.error).toBeNull();
  if (!result.data) throw new Error("Saved schedule missing.");
  return result.data;
}
async function scheduleEntries(actor: SupabaseClient) {
  const result = await actor.rpc("training_schedule_snapshot");
  expect(result.error).toBeNull();
  return z.object({ entries: z.array(z.object({
    id: z.string(), programId: z.string().nullable(), source: z.string(), date: z.string(), state: z.string(),
  }).passthrough()) }).parse(result.data).entries;
}
async function start(page: Page, id: string) {
  await page.goto(`/app/sessions/start/${id}`);
  await expect(page).toHaveURL(/\/app\/sessions\/[0-9a-f-]+(?:\?|$)/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}
async function loggedSets(actor: SupabaseClient, sessionId: string) {
  const result = await actor.from("set_logs").select("movement_id,prescription_item_index,reps,weight_kg")
    .eq("session_id", sessionId).order("created_at");
  expect(result.error).toBeNull();
  return result.data ?? [];
}

async function createRehabInLibrary(page: Page, selected: Movement, name: string, actor?: SupabaseClient, timeout?: number, caseId: "m13" | "m14" = "m13") {
  const observation = actor ? observeNativeUi(page, caseId, "", async () => {
    const read = await actor.from("rehab_protocols").select("id").eq("name", name)
      .limit(1).abortSignal(AbortSignal.timeout(1000));
    return read.error || !read.data ? "unavailable" : read.data.length ? "present" : "absent";
  }) : null;
  try {
  await page.goto("/app/settings/rehab-protocols");
  await page.getByRole("button", { name: "Create a protocol", exact: true }).click();
  await page.getByTestId("rehab-protocol-name").fill(name);
  await page.getByTestId("rehab-protocol-search").fill(selected.display_name);
  await page.getByTestId("rehab-protocol-picker").getByRole("button")
    .filter({ has: page.getByText(selected.display_name, { exact: true }) }).click();
  await page.getByLabel("Sets", { exact: true }).fill("1");
  await page.getByLabel("Reps", { exact: true }).fill("5");
  await page.getByLabel("Load kg", { exact: true }).fill("20");
  await observation?.capture();
  await page.getByTestId("rehab-protocol-save").click();
  await observation?.capture();
  await expect(page.getByTestId("rehab-protocol-new")).toBeVisible({ timeout });
  if (observation) clearNativeUiObservation();
  } catch (error) { await observation?.recordFailure(); throw error; }
  finally { observation?.dispose(); }
}

function clearNativeUiObservation() {
  const annotations = test.info().annotations;
  const index = annotations.findIndex((annotation) => annotation.type === "native-ui-failure");
  if (index >= 0) annotations.splice(index, 1);
}

async function draftPair(page: Page, catalog: Movement[], kind: "strength" | "running", name: string, offsets: [number, number]) {
  await begin(page, kind, name);
  await page.getByRole("button", { name: "1. Setup", exact: true }).click();
  await page.getByLabel("Weeks", { exact: true }).fill("1");
  await page.getByRole("button", { name: "3. Workout", exact: true }).click();
  await page.getByLabel("Workout name", { exact: true }).fill(`${name} A`);
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption(String((weekday() + offsets[0]) % 7));
  if (kind === "strength") await lift(page, movement(catalog, "bench-press-flat"));
  else await run(page, movement(catalog, "run-easy-z2"));
  await page.getByRole("button", { name: "Copy workout", exact: true }).click();
  await page.getByLabel("Workout name", { exact: true }).fill(`${name} B`);
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption(String((weekday() + offsets[1]) % 7));
}

async function importOverlappingCourse(page: Page, actor: SupabaseClient) {
  await page.goto("/app/swim/import");
  const source = syntheticCourse();
  await page.getByLabel("Prepared plan file").setInputFiles({
    name: "synthetic-course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
  await page.getByLabel("Start date", { exact: true }).fill(today());
  const sunday = new Date(`${today()}T00:00:00Z`).getUTCDay();
  for (const day of [sunday, (sunday + 2) % 7]) await page.locator(`input[name="weekdays"][value="${day}"]`).check();
  await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("trained");
  await page.getByLabel("Comfortable non-stop lengths in the plan pool").fill("40");
  await page.getByLabel("Freestyle", { exact: true }).check();
  await page.getByRole("button", { name: "Review plan", exact: true }).click();
  const overlap = page.getByLabel("Keep both workouts on these dates", { exact: true });
  await expect(overlap).not.toBeChecked();
  await page.getByLabel("I have reviewed the workouts, dates and pools").check();
  await page.getByRole("button", { name: "Import plan", exact: true }).click();
  expect((await actor.from("swim_plans").select("id")).data).toEqual([]);
  await expect(overlap).toBeVisible();
  await overlap.check();
  await page.getByRole("button", { name: "Import plan", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/swim\?plan=/);
  return z.string().uuid().parse(new URL(page.url()).searchParams.get("plan"));
}

test.describe("Modular program builder", () => {
  test.skip(process.env.SXC_ACCEPTANCE_PROFILE !== "modular", "Requires the disposable modular acceptance profile.");
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });

  test("M1 DC-K4: strength creation retains library identities through reload and logging", async ({ page, actor, catalog }) => {
    const selected = movement(catalog, "bench-press-flat");
    await begin(page, "strength", "Strength acceptance");
    await lift(page, selected);
    await review(page); await save(page, actor, "strength");
    const rows = await planned(actor);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.prescription.items).toMatchObject([{ movementId: selected.id, reps: 5, targetWeightKg: 20 }]);
    await page.reload();
    expect((await planned(actor)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
    const sessionId = await start(page, rows[0]!.id);
    await expect(page.getByTestId("movement-focus-log-button")).toBeEnabled();
    await page.getByTestId("movement-focus-log-button").click();
    await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(1);
    expect(await loggedSets(actor, sessionId)).toMatchObject([{ movement_id: selected.id, prescription_item_index: 0, reps: 5 }]);
    await page.reload();
    expect((await planned(actor))[0]!.completed_session_id).toBe(sessionId);
    expect(await loggedSets(actor, sessionId)).toHaveLength(1);
  });

  test("M2 DC-K4: running setup and future edits retain typed prescriptions", async ({ page, actor, catalog }) => {
    const selected = movement(catalog, "run-easy-z2");
    await begin(page, "running", "Running acceptance");
    await run(page, selected); await review(page); await save(page, actor, "running");
    const rows = await planned(actor);
    const original = rows[0]!.prescription;
    expect(original.items[0]).toMatchObject({ movementId: selected.id, durationMin: 2, meta: {
      repeats: 2, intervals: [{ target: { kind: "time", seconds: 60 } }],
    } });
    await page.goto(`/app/program/build?edit=${rows[0]!.block_id}&workout=${rows[0]!.id}`);
    await page.getByLabel("Repeat sequence", { exact: true }).fill("3");
    await page.getByRole("combobox", { name: "Apply changes to", exact: true }).selectOption("future");
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await save(page, actor, "running");
    const edited = await planned(actor);
    expect(edited.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    for (const row of edited) expect(row.prescription.items[0]).toMatchObject({ movementId: selected.id, durationMin: 3, meta: { repeats: 3 } });
    await page.goto(`/app/program/build?edit=${rows[0]!.block_id}&workout=${rows[0]!.id}`);
    await page.getByLabel("Repeat sequence", { exact: true }).fill("5");
    await page.getByRole("link", { name: "Cancel", exact: true }).click();
    expect((await planned(actor)).map((row) => row.prescription)).toEqual(edited.map((row) => row.prescription));
  });

  test("M3 DC-K4: hybrid repeats and activity views retain one workout identity", async ({ page, actor, catalog }) => {
    const running = movement(catalog, "run-easy-z2"), first = movement(catalog, "goblet-squat"), second = movement(catalog, "bench-press-flat");
    stage("m3-01");
    await begin(page, "hybrid", "Mixed acceptance");
    stage("m3-02");
    await run(page, running, "hybrid");
    stage("m3-03");
    await page.getByRole("button", { name: "Add circuit", exact: true }).click();
    const circuit = page.locator("article").last();
    stage("m3-04");
    await circuit.getByLabel("Rounds", { exact: true }).fill("2");
    await circuit.getByLabel("Search library", { exact: true }).first().fill(first.display_name);
    await circuit.getByRole("button", { name: first.display_name, exact: true }).first().click();
    await circuit.getByLabel("Search library", { exact: true }).fill(second.display_name);
    await circuit.getByRole("button", { name: second.display_name, exact: true }).click();
    for (const input of await circuit.getByLabel("Load (kg)", { exact: true }).all()) await input.fill("20");
    for (const input of await circuit.getByLabel("Rest (seconds)", { exact: true }).all()) await input.fill("0");
    stage("m3-05");
    await review(page);
    stage("m3-06");
    await save(page, actor, "hybrid");
    stage("m3-07");
    const rows = await planned(actor), row = rows[0]!;
    expect(row.prescription.items).toHaveLength(5);
    expect(row.prescription.items.slice(1).map((item) => item.circuit?.round)).toEqual([0, 1, 0, 1]);
    stage("m3-08");
    for (const path of ["/app/programs", "/app/programs?activity=hybrid"]) {
      await page.goto(path);
      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      await expect(page.locator(`a[href="/app/sessions/start/${row.id}"]`)).toBeVisible();
    }
    for (const activity of ["strength", "running"]) {
      await page.goto(`/app/programs?activity=${activity}`);
      await expect(page.locator(`a[href="/app/sessions/start/${row.id}"]`)).toHaveCount(0);
    }
    stage("m3-09");
    const sessionId = await start(page, row.id);
    await expect(page.getByRole("navigation", { name: "Workout parts", exact: true }).getByRole("button")).toHaveCount(2);
    stage("m3-10");
    await page.getByTestId("cardio-log-submit").click();
    stage("m3-11");
    await expect(page.getByTestId("movement-focus-log-button")).toBeVisible();
    stage("m3-12");
    for (let index = 0; index < 4; index++) {
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(index + 1);
    }
    stage("m3-13");
    const indices = (await loggedSets(actor, sessionId)).map((entry) => entry.prescription_item_index);
    diagnosticAnnotation("modular-set-indices", indices.length === 4 && indices.every(
      (index: unknown) => typeof index === "number" && Number.isInteger(index) && index >= 0 && index <= 4,
    ) ? JSON.stringify(indices) : "invalid");
    expect(indices).toEqual([1, 3, 2, 4]);
    stage("m3-14");
    const cardio = await actor.from("cardio_logs").select("block_index,movement_id,duration_sec").eq("session_id", sessionId);
    expect(cardio.error).toBeNull();
    expect(cardio.data).toEqual([{ block_index: 1, movement_id: running.id, duration_sec: 120 }]);
    stage("m3-15");
    await page.reload();
    expect((await planned(actor))[0]!.completed_session_id).toBe(sessionId);
    expect(await loggedSets(actor, sessionId)).toHaveLength(4);
    stage("m3-16");
    await expect(page.getByTestId("finish-stickybar")).toHaveAttribute("data-armed", "true");
  });

  test("M4 DC-SW7: swimming coexists with reviewed primary commitments and independent lifecycle", async ({ page, actor, catalog }) => {
    stage("m4-01");
    await begin(page, "strength", "Independent strength");
    stage("m4-02");
    await lift(page, movement(catalog, "bench-press-flat"));
    stage("m4-03");
    await review(page);
    stage("m4-04");
    await save(page, actor, "strength");
    stage("m4-05");
    const primary = await planned(actor);
    stage("m4-06");
    await page.goto("/app/swim/import");
    const source = syntheticCourse();
    stage("m4-07");
    await page.getByLabel("Prepared plan file").setInputFiles({
      name: "synthetic-course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)),
    });
    await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
    const sunday = new Date(`${today()}T00:00:00Z`).getUTCDay();
    stage("m4-08");
    for (const day of [(sunday + 1) % 7, (sunday + 3) % 7]) await page.locator(`input[name="weekdays"][value="${day}"]`).check();
    await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("trained");
    await page.getByLabel("Comfortable non-stop lengths in the plan pool").fill("40");
    await page.getByLabel("Freestyle", { exact: true }).check();
    stage("m4-09");
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    stage("m4-10");
    await page.getByLabel("I have reviewed the workouts, dates and pools").check();
    stage("m4-11");
    await page.getByRole("button", { name: "Import plan", exact: true }).click();
    stage("m4-12");
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);
    stage("m4-13");
    const swims = await actor.from("swim_workouts").select("id,scheduled_date").order("scheduled_date");
    expect(swims.error).toBeNull(); expect(swims.data).toHaveLength(3);
    const beforeMove = await scheduleEntries(actor);
    const sharedDate = addDaysToYmd(today(), 7);
    expect(swims.data!.some((row) => row.scheduled_date === sharedDate)).toBe(false);
    stage("m4-14");
    await page.getByText("Move swim", { exact: true }).last().click();
    const editor = page.locator("details").filter({ has: page.getByLabel("Swim date") }).last();
    stage("m4-15");
    await editor.getByLabel("Swim date").fill(sharedDate);
    await editor.getByLabel("Reason", { exact: true }).fill("Reviewed two-workout day");
    stage("m4-16");
    await editor.getByRole("button", { name: "Preview date", exact: true }).click();
    stage("m4-17");
    await expect(editor.getByRole("button", { name: "Save date", exact: true })).toBeDisabled();
    stage("m4-18");
    await editor.getByLabel("Keep both workouts on this date").check();
    stage("m4-19");
    await editor.getByRole("button", { name: "Save date", exact: true }).click();
    stage("m4-20");
    await expect.poll(async () => (await actor.from("swim_workouts").select("scheduled_date").eq("id", swims.data!.at(-1)!.id).single()).data?.scheduled_date).toBe(sharedDate);
    stage("m4-21");
    expect((await actor.from("swim_workouts").select("id")).data).toHaveLength(3);
    const afterMove = await scheduleEntries(actor), moved = swims.data!.at(-1)!;
    expect(afterMove.filter((entry) => entry.id === moved.id))
      .toEqual(beforeMove.filter((entry) => entry.id === moved.id).map((entry) => ({ ...entry, date: sharedDate })));
    expect(afterMove.filter((entry) => entry.date === moved.scheduled_date && entry.id === moved.id)).toEqual([]);
    expect(afterMove.filter((entry) => entry.id !== moved.id)).toEqual(beforeMove.filter((entry) => entry.id !== moved.id));
    expect(afterMove.filter((entry) => entry.date === sharedDate && entry.state !== "rest")).toHaveLength(2);
    stage("m4-22");
    await openSwimProgramActions(page);

    await page.getByRole("button", { name: "Finish plan", exact: true }).click();
    stage("m4-23");
    await expect.poll(async () => (await actor.from("swim_plans").select("status").single()).data?.status).toBe("finished");
    stage("m4-24");
    expect((await planned(actor)).map((row) => [row.id, row.week_index, row.day_index])).toEqual(primary.map((row) => [row.id, row.week_index, row.day_index]));
    expect((await actor.from("training_blocks").select("status").single()).data?.status).toBe("active");
    const afterEnd = await scheduleEntries(actor);
    expect(afterEnd.filter((entry) => entry.source === "swim")).toEqual([]);
    expect(afterEnd).toEqual(beforeMove.filter((entry) => entry.source === "primary"));
  });

  test("M5 DC-K4: stale schedule review and retried saves preserve one accepted program", async ({ page, actor, catalog, freshUser }) => {
    await begin(page, "strength", "Freshness acceptance");
    await lift(page, movement(catalog, "bench-press-flat")); await review(page);
    const other = await actor.from("sessions").insert({ user_id: freshUser.userId, title: "Synthetic other work",
      performed_at: `${addDaysToYmd(today(), 1)}T12:00:00Z` });
    expect(other.error).toBeNull();
    await page.getByRole("button", { name: "Start program", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("changed");
    expect((await actor.from("training_blocks").select("id")).data).toHaveLength(0);
    await page.getByRole("button", { name: "Back", exact: true }).click(); await review(page);
    const posted = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
    await save(page, actor, "strength");
    const request = await posted, rows = await planned(actor);
    const replay = await page.request.post(request.url(), { headers: request.headers(), data: request.postDataBuffer()! });
    expect(replay.ok()).toBe(true);
    expect(await replay.text()).toContain(rows[0]!.block_id);
    expect((await actor.from("training_blocks").select("id")).data).toHaveLength(1);
    expect((await planned(actor)).map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  test("M6 DC-SW8: two users cannot read or change each other's programs", async ({ page, actor, catalog, admin, browser, seedConfig, baseURL }) => {
    const email = `e2e+${randomUUID()}@hta-e2e.com`, password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    if (!created.data.user) throw new Error("Second synthetic user missing.");
    const secondId = created.data.user.id;
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      await markOnboarded(admin, secondId);
      await signInAs(context, { email, password }, seedConfig, baseURL!);
      const second = createClient(seedConfig.supabaseUrl, seedConfig.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await second.auth.signInWithPassword({ email, password })).error).toBeNull();
      const other = await context.newPage();
      await begin(page, "strength", "First private program"); await lift(page, movement(catalog, "bench-press-flat")); await review(page); await save(page, actor, "strength");
      await begin(other, "strength", "Second private program"); await lift(other, movement(catalog, "goblet-squat")); await review(other); await save(other, second, "strength");
      const [firstRows, secondRows] = await Promise.all([planned(actor), planned(second)]);
      expect(firstRows[0]!.block_id).not.toBe(secondRows[0]!.block_id);
      expect((await actor.from("planned_sessions").select("id").eq("id", secondRows[0]!.id)).data).toEqual([]);
      expect((await second.from("program_instances").select("id").eq("block_id", firstRows[0]!.block_id)).data).toEqual([]);
      const snapshot = await second.rpc("training_schedule_snapshot");
      expect(snapshot.error).toBeNull();
      const denied = await second.rpc("training_schedule_commit", { p_operation: "primary-skip",
        p_args: { id: firstRows[0]!.id, reason: "Cross-user refusal" }, p_expected_revision: snapshot.data.revision,
        p_request_id: randomUUID(), p_input_hash: "a".repeat(64), p_accept_overlap: false });
      expect(denied.error).not.toBeNull();
      expect((await actor.from("planned_sessions").select("skipped_at").eq("id", firstRows[0]!.id).single()).data?.skipped_at).toBeNull();
      expect((await planned(second)).map((row) => row.id)).toEqual(secondRows.map((row) => row.id));
    } catch (error) { failurePhase("test"); throw error; }
    finally { await nativeTeardown(async () => {
      await context.close();
      expect((await admin.auth.admin.deleteUser(secondId)).error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(secondId);
      expect(remaining.data.user).toBeNull(); expect(remaining.error?.status).toBe(404);
    }); }
  });

  test("M7 DC-SW5: explicit imported outcomes stay consistent across training views and retained history", async ({ page, actor, freshUser }) => {
    expect((await actor.from("profiles").update({ date_format: "iso" }).eq("id", freshUser.userId)).error).toBeNull();
    await page.goto("/app/swim/import");
    const source = syntheticCourse(), scheduledDate = today(), recordedDate = addDaysToYmd(scheduledDate, -1);
    await page.getByLabel("Prepared plan file").setInputFiles({
      name: "synthetic-course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)),
    });
    await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
    await page.getByLabel("Start date", { exact: true }).fill(scheduledDate);
    const sunday = new Date(`${scheduledDate}T00:00:00Z`).getUTCDay();
    for (const day of [sunday, (sunday + 2) % 7]) await page.locator(`input[name="weekdays"][value="${day}"]`).check();
    await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("trained");
    await page.getByLabel("Comfortable non-stop lengths in the plan pool").fill("40");
    await page.getByLabel("Freestyle", { exact: true }).check();
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await page.getByLabel("I have reviewed the workouts, dates and pools").check();
    await page.getByRole("button", { name: "Import plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);

    const workouts = async () => {
      const result = await actor.from("swim_workouts")
        .select("id,plan_id,scheduled_date,revision,status,session_id,definition")
        .eq("user_id", freshUser.userId).order("scheduled_date");
      expect(result.error).toBeNull();
      return z.array(z.object({
        id: z.string().uuid(), plan_id: z.string().uuid(), scheduled_date: z.string(),
        revision: z.number().int().positive(), status: z.string(), session_id: z.string().uuid().nullable(),
        definition: z.unknown(),
      })).length(3).parse(result.data);
    };
    const original = await workouts(), first = original[0]!;
    expect(first.scheduled_date).toBe(scheduledDate);
    const outcomes = async () => {
      const result = await actor.from("swim_import_outcomes").select(importOutcomeColumns)
        .eq("user_id", freshUser.userId).eq("workout_id", first.id).order("revision");
      expect(result.error).toBeNull();
      return z.array(importOutcomeSchema).parse(result.data);
    };
    await page.goto("/app/settings/swimming");
    await page.getByRole("button", { name: "Create import key", exact: true }).click();
    const keyInput = page.getByLabel("Import key", { exact: true });
    await expect(keyInput).toBeVisible();
    const importKey = await keyInput.inputValue();
    const imported = await page.request.post("/api/swim/import", {
      headers: { authorization: `Bearer ${importKey}`, "content-type": "application/json" }, maxRedirects: 0,
      data: { version: 1, activity: {
        activity_id: "930000000007", date: recordedDate, type: "lap_swimming", distance_m: 350, duration_s: 900,
      }, detail: null },
    });
    expect(imported.status()).toBe(201);
    const receipt = z.object({ id: z.string().uuid(), revision: z.literal(1), replayed: z.literal(false) })
      .strict().parse(await imported.json());
    const recordingHref = `/app/swim/recordings/${receipt.id}?workout=${first.id}&from=sessions`;
    await page.goto(recordingHref);
    await page.getByLabel("Workout date", { exact: true }).fill(scheduledDate);
    await page.getByRole("button", { name: "Find workouts", exact: true }).click();
    await page.getByRole("combobox", { name: "Workout", exact: true }).selectOption(first.id);
    await page.getByRole("button", { name: "Match workout", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeVisible();
    const matched = await actor.from("swim_current_import_matches").select(matchColumns)
      .eq("user_id", freshUser.userId).eq("import_id", receipt.id).single();
    expect(matched.error).toBeNull();
    const match = matchSchema.parse(matched.data);
    expect(match.workout_id).toBe(first.id);
    expect(await outcomes()).toEqual([]);
    const region = page.getByRole("region").filter({
      has: page.locator(`h2 a[href="/app/swim/${first.id}?from=sessions"]`),
    });
    await expect(region).toHaveCount(1);
    await expect(region.getByRole("button", { name: "Confirm outcome", exact: true })).toBeDisabled();
    await region.getByRole("radio", { name: "Completed", exact: true }).check();
    const posted = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
    await region.getByRole("button", { name: "Confirm outcome", exact: true }).click();
    await expect(region.locator('p[aria-live="polite"]')).toHaveText("Completed");
    const accepted = await outcomes();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ workout_id: first.id, match_id: match.id,
      metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: first.revision } });
    const request = await posted;
    const replay = await page.request.post(request.url(), { headers: request.headers(), data: request.postDataBuffer()! });
    expect(replay.ok()).toBe(true);
    expect(await replay.text()).toContain(accepted[0]!.id);
    expect(await outcomes()).toEqual(accepted);

    const sharedStatus = async (label: string) => {
      for (const path of ["/app", "/app/plan", `/app/swim?plan=${first.plan_id}`]) {
        await page.goto(path);
        const hub = path.startsWith("/app/swim");
        const scope = hub ? page.getByRole("list", { name: "Swims", exact: true })
          : page.getByRole("region", { name: path === "/app/plan" ? "This week" : "Swimming schedule", exact: true });
        const link = scope.locator(`a[href^="/app/swim/${first.id}"]`);
        await expect(link).toBeVisible();
        await expect(link).toContainText(path === "/app/plan" && label === "Scheduled" ? "Start workout" : label);
        if (path === "/app" && label !== "Scheduled") {
          const recent = page.getByRole("region", { name: "Recent activity", exact: true })
            .locator(`a[href="/app/swim/recordings/${receipt.id}?workout=${first.id}&from=today"]`);
          await expect(recent).toContainText(label);
          await expect(recent).toContainText(recordedDate);
          await expect(recent).not.toContainText(scheduledDate);
        }
        if (hub) {
          const nextId = label === "Scheduled" ? first.id : original[1]!.id;
          await expect(page.getByRole("link", { name: /^Next swim\b/ }))
            .toHaveAttribute("href", new RegExp(`^/app/swim/${nextId}(?:\\?|$)`));
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
    };
    const openHistory = async (label: string) => {
      await page.goto("/app/sessions");
      const link = page.locator(`a[href="${recordingHref}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toContainText(label);
      await expect(link).toContainText(recordedDate);
      await expect(link).not.toContainText(scheduledDate);
      await link.click();
      await expect(page.getByTestId("page-header").locator('a[href="/app/sessions"]')).toBeVisible();
    };
    await sharedStatus("Completed");
    await openHistory("Completed");
    await region.getByRole("link", { name: match.metadata.workout!.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/swim/${first.id}\\?from=sessions$`));
    await page.getByTestId("page-header").locator('a[href="/app/sessions"]').click();
    await expect(page).toHaveURL(/\/app\/sessions$/);
    await page.locator(`a[href="${recordingHref}"]`).click();
    await region.getByRole("button", { name: "Change outcome", exact: true }).click();
    await region.getByRole("radio", { name: "Stopped early", exact: true }).check();
    await region.getByRole("button", { name: "Confirm outcome", exact: true }).click();
    await expect(region.locator('p[aria-live="polite"]')).toHaveText("Stopped early");
    const corrected = await outcomes();
    expect(corrected).toHaveLength(2);
    expect(corrected[1]).toMatchObject({ match_id: match.id,
      metadata: { outcome: "stopped_early", previousOutcomeId: accepted[0]!.id, workoutRevision: first.revision } });
    await sharedStatus("Stopped early");
    await openHistory("Stopped early");
    await page.getByRole("button", { name: "Remove match", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove match", exact: true })).toHaveCount(0);
    await expect(region.getByRole("button", { name: "Remove confirmation", exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "Confirm outcome", exact: true })).toHaveCount(0);
    await sharedStatus("Review recording");
    await openHistory("Review recording");
    await region.getByRole("button", { name: "Remove confirmation", exact: true }).click();
    await expect(region).toHaveCount(0);
    await sharedStatus("Scheduled");
    await page.goto("/app/sessions");
    await expect(page.locator(`a[href="${recordingHref}"]`)).toHaveCount(0);
    const removed = await outcomes();
    expect(removed).toHaveLength(3);
    expect(removed[2]).toMatchObject({ match_id: null,
      metadata: { outcome: null, previousOutcomeId: corrected[1]!.id, workoutRevision: null } });
    expect(await workouts()).toEqual(original);
    for (const [table, query] of Object.entries(standaloneOutcomeNativeQueries(actor, freshUser.userId))) {
      const result = await query;
      expect(result.error, table).toBeNull(); expect(result.data, table).toEqual([]);
    }
    const exported = await page.request.get("/api/me/export");
    expect(exported.status()).toBe(200);
    const history = standaloneOutcomeExportSchema.parse(await exported.json());
    expect(history.swim_import_outcomes.sort((a, b) => a.revision - b.revision)).toEqual(removed);
    expect(history.swim_imports).toEqual([{ id: receipt.id, evidence: { date: recordedDate } }]);
    for (const table of ["sessions", "cardio_logs", "set_logs", "training_blocks", "planned_sessions"] as const) {
      expect(history[table], table).toEqual([]);
    }
  });

  legacyTest("M8 DC-K4: legacy refusal preserves drafts and history until the owner explicitly ends it",
    async ({ page, actor, catalog, legacy, context }) => {
      stage("m8-01");
      const before = await legacyGraphSnapshot(actor, legacy.userId);
      expect(before.sha256).toBe(legacy.beforeSha256);
      const older = await actor.from("training_blocks").select("id,program_kind,status").eq("id", legacy.blockId).single();
      expect(older.error).toBeNull();
      expect(older.data).toEqual({ id: legacy.blockId, program_kind: null, status: "active" });
      stage("m8-02"); await draftPair(page, catalog, "strength", "Strength week", [0, 3]);
      await page.getByRole("button", { name: "Review program", exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      await expect(page.getByLabel("Workout name", { exact: true })).toHaveValue("Strength week B");
      expect((await actor.from("training_blocks").select("id").not("program_kind", "is", null)).data).toEqual([]);
      const history = await context.newPage();
      const observation = observeNativeUi(history, "m8", "", async () => {
        const read = await actor.from("training_blocks").select("status,deleted_at").eq("id", legacy.blockId)
          .abortSignal(AbortSignal.timeout(1000)).maybeSingle();
        if (read.error) return "unavailable";
        if (!read.data) return "absent";
        return read.data.deleted_at ? "deleted" : z.enum(["active", "archived", "completed"]).parse(read.data.status);
      });
      try {
        stage("m8-03");
        await history.goto(`/app/plan?block=${legacy.blockId}`);
        await observation.capture();
        await history.getByTestId("program-actions-more").click();
        await observation.capture();
        await history.getByTestId("program-actions-end").click();
        await observation.capture();
        stage("m8-04"); await history.getByTestId("end-block-confirm").click();
        await expect.poll(async () => (await actor.from("training_blocks").select("status").eq("id", legacy.blockId).single()).data?.status)
          .toBe("archived");
        stage("m8-05"); const after = await legacyGraphSnapshot(actor, legacy.userId);
        for (const table of ["planned_sessions", "sessions", "set_logs"]) expect(after.rows[table]).toEqual(before.rows[table]);
        stage("m8-06"); await history.goto(`/app/sessions/${legacy.sessionId}`);
        await expect(history.getByTestId("session-title")).toContainText("Older strength workout");
        expect(await loggedSets(actor, legacy.sessionId)).toHaveLength(1);
      } catch (error) { await observation.recordFailure(); throw error; }
      finally { observation.dispose(); await history.close(); }
      clearNativeUiObservation();
      stage("m8-07"); await review(page, test.info().timeout);
      expect((await scheduleEntries(actor)).filter((entry) => entry.id === legacy.sessionId)).toMatchObject([{
        id: legacy.sessionId, source: "session", programId: null, date: today(),
        state: "completed", title: "Older strength workout",
      }]);
      const overlap = page.getByRole("checkbox", { name: "Keep both workouts on these dates.", exact: true });
      await expect(overlap).toBeVisible();
      await expect(overlap.locator("../..").locator("time")).toHaveText([today()]);
      await expect(overlap.locator("../..").locator("span")).toHaveText(["Older strength workout"]);
      await expect(overlap).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Start program", exact: true })).toBeDisabled();
      await overlap.check();
      const strengthId = await save(page, actor, "strength", test.info().timeout);
      stage("m8-08");
      expect((await planned(actor)).filter((row) => row.block_id === strengthId)).toHaveLength(2);
      const retained = await actor.from("sessions").select("id").eq("user_id", legacy.userId);
      expect(retained.error).toBeNull(); expect(retained.data).toEqual([{ id: legacy.sessionId }]);
    });

  ownedTest("M9 DC-K4/DC-SW7: three independent two-day programs share an explicitly accepted date",
    async ({ page, actor, catalog, freshUser }) => {
      await draftPair(page, catalog, "strength", "Strength week", [0, 3]);
      await review(page);
      const strengthId = await save(page, actor, "strength");
      await draftPair(page, catalog, "running", "Running week", [1, 4]);
      await review(page);
      const runningId = await save(page, actor, "running");
      const swimId = await importOverlappingCourse(page, actor);
      const blocks = await actor.from("training_blocks").select("id,program_kind")
        .eq("status", "active").is("deleted_at", null).order("program_kind");
      expect(blocks.error).toBeNull();
      expect(blocks.data).toEqual([{ id: runningId, program_kind: "running" }, { id: strengthId, program_kind: "strength" }]);
      const current = await planned(actor);
      expect(current.filter((row) => row.block_id === strengthId)).toHaveLength(2);
      expect(current.filter((row) => row.block_id === runningId)).toHaveLength(2);
      const swims = await actor.from("swim_workouts").select("id,scheduled_date,session_id").eq("plan_id", swimId).order("scheduled_date");
      expect(swims.error).toBeNull(); expect(swims.data).toHaveLength(3);
      expect(swims.data!.filter((row) => row.scheduled_date >= today() && row.scheduled_date < addDaysToYmd(today(), 7))).toHaveLength(2);
      expect(swims.data!.every((row) => row.session_id === null)).toBe(true);
      const todayStrength = current.find((row) => row.block_id === strengthId && row.day_index === weekday())!;
      const todaySwim = swims.data![0]!;
      expect(todaySwim.scheduled_date).toBe(today());
      await page.goto("/app/programs");
      const programs = page.getByRole("region", { name: "Programs", exact: true });
      await expect(programs.locator("a[data-kind]")).toHaveCount(3);
      for (const name of ["Strength week", "Running week", "Swimming"]) {
        await expect(programs.getByText(name, { exact: true })).toBeVisible();
      }
      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      const week = page.getByRole("region", { name: "This week", exact: true });
      await expect(week.locator(`a[href="/app/sessions/start/${todayStrength.id}"]`)).toHaveCount(1);
      await expect(week.locator(`a[href^="/app/swim/${todaySwim.id}?"]`)).toHaveCount(1);
      const sharedDay = week.locator(`time[datetime="${today()}"]`).locator("../..");
      await expect(sharedDay.locator(`a[href="/app/sessions/start/${todayStrength.id}"]`)).toHaveCount(1);
      await expect(sharedDay.locator(`a[href^="/app/swim/${todaySwim.id}?"]`)).toHaveCount(1);
      await expect(sharedDay.locator('a[href^="/app/sessions/start/"],a[href^="/app/swim/"]')).toHaveCount(2);
      for (const path of ["/app", "/app/plan"]) {
        await page.goto(path);
        const navigation = page.getByRole("main").getByRole("navigation", { name: "Programs", exact: true });
        await expect(navigation.locator(`a[href="/app/plan?block=${strengthId}"]`)).toBeVisible();
        await expect(navigation.locator(`a[href="/app/plan?block=${runningId}"]`)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      const noResults = await actor.from("sessions").select("id").eq("user_id", freshUser.userId);
      expect(noResults.error).toBeNull(); expect(noResults.data).toEqual([]);
    });

  ownedTest("M10 DC-K4/DC-SW7: fourth Hybrid and same-type replacement preserve peer edits",
    async ({ page, actor, catalog, freshUser }) => {
      const liftId = movement(catalog, "bench-press-flat").id, runId = movement(catalog, "run-easy-z2").id;
      const strength = await prepareNativeProgram(actor,
        nativeProgramDefinition("strength", "Native strength", weekday(), liftId, runId), today());
      const running = await prepareNativeProgram(actor,
        nativeProgramDefinition("running", "Native running", (weekday() + 1) % 7, liftId, runId), today());
      const swimming = await prepareNativeCourse(actor, today());
      const original = await planned(actor);
      const swimSnapshot = async () => {
        const plans = await actor.from("swim_plans").select("*").eq("user_id", freshUser.userId).order("id");
        const workouts = await actor.from("swim_workouts").select("*").eq("user_id", freshUser.userId).order("id");
        expect(plans.error).toBeNull(); expect(workouts.error).toBeNull();
        return { plans: plans.data, workouts: workouts.data };
      };
      const beforeSwim = await swimSnapshot();
      await begin(page, "hybrid", "Fourth hybrid");
      await run(page, movement(catalog, "run-easy-z2"), "hybrid");
      await lift(page, movement(catalog, "bench-press-flat"));
      await review(page);
      await page.getByRole("checkbox", { name: "Keep both workouts on these dates.", exact: true }).check();
      const hybridId = await save(page, actor, "hybrid");
      await page.goto("/app/programs");
      await expect(page.getByRole("region", { name: "Programs", exact: true }).locator("a[data-kind]")).toHaveCount(4);
      const hybridRows = (await planned(actor)).filter((row) => row.block_id === hybridId);
      const runRow = original.find((row) => row.block_id === running.block_id)!;
      await page.goto(`/app/program/build?edit=${running.block_id}&workout=${runRow.id}`);
      await page.getByLabel("Seconds", { exact: true }).fill("90");
      await page.getByRole("button", { name: "Review changes", exact: true }).click();
      await save(page, actor, "running");
      const afterEdit = await planned(actor);
      expect(afterEdit.find((row) => row.id === runRow.id)?.prescription.items[0]).toMatchObject({
        movementId: runId, durationMin: 1.5, meta: { intervals: [{ target: { kind: "time", seconds: 90 } }] },
      });
      expect(afterEdit.filter((row) => row.block_id === strength.block_id)).toEqual(original.filter((row) => row.block_id === strength.block_id));
      expect(afterEdit.filter((row) => row.block_id === hybridId)).toEqual(hybridRows);
      await begin(page, "strength", "Replacement strength");
      await lift(page, movement(catalog, "bench-press-flat"));
      await review(page);
      await expect(page.getByRole("button", { name: "Start program", exact: true })).toBeDisabled();
      await page.getByRole("checkbox", { name: "Keep both workouts on these dates.", exact: true }).check();
      await page.getByRole("button", { name: "Start program", exact: true }).click();
      const replacement = page.getByRole("dialog", { name: "Replace Native strength?", exact: true });
      await expect(replacement).toBeVisible();
      await expect(page.getByRole("dialog", { name: /Replace (Native running|Fourth hybrid|Swimming)/ })).toHaveCount(0);
      await replacement.getByRole("button", { name: "Cancel", exact: true }).click();
      const replacementId = await save(page, actor, "strength", undefined, "Native strength");
      expect(replacementId).not.toBe(strength.block_id);
      const replaced = await actor.from("training_blocks").select("status").eq("id", strength.block_id).single();
      expect(replaced.error).toBeNull(); expect(replaced.data?.status).toBe("archived");
      expect((await planned(actor)).filter((row) => row.block_id === strength.block_id)).toEqual(original.filter((row) => row.block_id === strength.block_id));
      expect((await planned(actor)).filter((row) => row.block_id === running.block_id)).toEqual(afterEdit.filter((row) => row.block_id === running.block_id));
      expect((await planned(actor)).filter((row) => row.block_id === hybridId)).toEqual(hybridRows);
      expect(await swimSnapshot()).toEqual(beforeSwim);
      expect(beforeSwim.plans?.map((row) => row.id)).toEqual([swimming.plan.id]);
      const instances = await actor.from("program_instances").select("block_id,status,deleted_at")
        .eq("user_id", freshUser.userId).order("block_id");
      expect(instances.error).toBeNull(); expect(instances.data).toHaveLength(4);
      expect(instances.data).toEqual(expect.arrayContaining([
        { block_id: hybridId, status: "active", deleted_at: null },
        { block_id: replacementId, status: "active", deleted_at: null },
        { block_id: running.block_id, status: "active", deleted_at: null },
        { block_id: strength.block_id, status: "archived", deleted_at: null },
      ]));
    });

  ownedTest("M11 DC-K4/DC-SW7: trash restore and a shorter program ending preserve the longer calendars",
    async ({ page, actor, catalog, freshUser }) => {
      const liftId = movement(catalog, "bench-press-flat").id, runId = movement(catalog, "run-easy-z2").id;
      const strength = await prepareNativeProgram(actor,
        { ...nativeProgramDefinition("strength", "Long strength", weekday(), liftId, runId), weeks: 4 }, today());
      const running = await prepareNativeProgram(actor,
        nativeProgramDefinition("running", "Short running", (weekday() + 1) % 7, liftId, runId), today());
      const hybrid = await prepareNativeProgram(actor,
        { ...nativeProgramDefinition("hybrid", "Long hybrid", weekday(), liftId, runId), weeks: 4 }, today());
      const swimming = await prepareNativeCourse(actor, today());
      const original = await planned(actor), hybridId = hybrid.block_id;
      const hybridRows = original.filter((row) => row.block_id === hybridId);
      const swimSnapshot = async () => {
        const plans = await actor.from("swim_plans").select("*").eq("user_id", freshUser.userId).order("id");
        const workouts = await actor.from("swim_workouts").select("*").eq("user_id", freshUser.userId).order("id");
        expect(plans.error).toBeNull(); expect(workouts.error).toBeNull();
        return { plans: plans.data, workouts: workouts.data };
      };
      const beforeSwim = await swimSnapshot();
      const beforeEntries = await scheduleEntries(actor);
      const hybridHistory = page.locator(`[data-testid="block-history-row"][data-block-id="${hybridId}"]`);
      const observation = observeNativeUi(page, "m11", hybridId, async () => {
        const read = await actor.from("training_blocks").select("deleted_at").eq("id", hybridId)
          .abortSignal(AbortSignal.timeout(1000)).maybeSingle();
        return read.error ? "unavailable" : !read.data ? "absent" : read.data.deleted_at ? "deleted" : "retained";
      });
      try {
        await page.goto("/app/plan/history");
        await observation.capture();
        await hybridHistory.getByTestId("block-actions-trigger").click();
        await observation.capture();
        await hybridHistory.getByTestId("delete-block-menu-item").click();
        await observation.capture();
        await expect(hybridHistory).toHaveCount(0, { timeout: test.info().timeout });
      }
      catch (error) {
        await observation.recordFailure();
        try {
          const errors = await hybridHistory.getByTestId("block-actions-menu").locator("p").allTextContents();
          diagnosticAnnotation("history-delete-failure", classifyHistoryDeleteFailure(errors.length === 1 ? errors[0]! : null));
        } catch { diagnosticAnnotation("history-delete-failure", "unavailable"); }
        throw error;
      }
      finally { observation.dispose(); }
      clearNativeUiObservation();
      const deleted = await actor.from("program_instances").select("status,deleted_at").eq("block_id", hybridId).single();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual({ status: "archived", deleted_at: expect.any(String) });
      await page.goto("/app/settings/trash");
      const trash = page.locator(`[data-testid="trash-item"][data-id="${hybridId}"]`);
      await trash.getByTestId("recover-button").click();
      await trash.getByRole("checkbox", { name: "Keep both workouts on these dates", exact: true }).check();
      await trash.getByTestId("recover-button").click();
      await expect(trash).toHaveCount(0);
      expect((await planned(actor)).filter((row) => row.block_id === hybridId)).toEqual(hybridRows);
      await page.goto(`/app/plan?block=${running.block_id}`);
      await page.getByTestId("program-actions-more").click();
      await page.getByTestId("program-actions-end").click();
      await page.getByTestId("end-block-confirm").click();
      await expect.poll(async () => {
        const result = await actor.from("training_blocks").select("status").eq("id", running.block_id).single();
        expect(result.error).toBeNull(); return result.data?.status;
      }).toBe("archived");
      const active = await actor.from("training_blocks").select("id,program_kind")
        .eq("user_id", freshUser.userId).eq("status", "active").is("deleted_at", null).order("program_kind");
      expect(active.error).toBeNull();
      expect(active.data).toEqual([{ id: hybridId, program_kind: "hybrid" }, { id: strength.block_id, program_kind: "strength" }]);
      const instances = await actor.from("program_instances").select("block_id,status,deleted_at")
        .eq("user_id", freshUser.userId).in("block_id", [hybridId, running.block_id, strength.block_id]);
      expect(instances.error).toBeNull();
      expect(instances.data).toEqual(expect.arrayContaining([
        { block_id: hybridId, status: "active", deleted_at: null },
        { block_id: strength.block_id, status: "active", deleted_at: null },
        { block_id: running.block_id, status: "archived", deleted_at: null },
      ]));
      expect(instances.data).toHaveLength(3);
      expect(await planned(actor)).toEqual(original);
      expect(await swimSnapshot()).toEqual(beforeSwim);
      expect(beforeSwim.plans?.map((row) => row.id)).toEqual([swimming.plan.id]);
      expect((await actor.from("sessions").select("id").eq("user_id", freshUser.userId)).data).toEqual([]);
      const afterEntries = await scheduleEntries(actor);
      expect(afterEntries.filter((entry) => entry.programId === running.block_id)).toEqual([]);
      const peers = beforeEntries.filter((entry) => entry.programId !== running.block_id);
      expect(afterEntries).toEqual(peers);
      expect(new Set(afterEntries.map((entry) => `${entry.source}:${entry.id}`)).size).toBe(afterEntries.length);
      expect(afterEntries.filter((entry) => entry.programId === strength.block_id && entry.state !== "rest" && entry.date >= addDaysToYmd(today(), 14)))
        .toHaveLength(2);
      await page.goto("/app/programs");
      await page.getByRole("link", { name: "Schedule", exact: true }).click();
      const week = page.getByRole("region", { name: "This week", exact: true });
      for (const row of original.filter((row) => row.block_id === running.block_id)) {
        await expect(week.locator(`a[href="/app/sessions/start/${row.id}"]`)).toHaveCount(0);
      }
      const sharedDay = week.locator(`time[datetime="${today()}"]`).locator("../..");
      for (const id of [strength.block_id, hybridId]) {
        const row = original.find((entry) => entry.block_id === id)!;
        const calendar = observeNativeUi(page, "m11", row.id, async () => {
          const read = await actor.from("planned_sessions").select("id").eq("id", row.id)
            .abortSignal(AbortSignal.timeout(1000)).maybeSingle();
          return read.error ? "unavailable" : read.data ? "retained" : "absent";
        }, today());
        try {
          await expect(sharedDay.locator(`a[href="/app/sessions/start/${row.id}"]`)).toHaveCount(1);
          clearNativeUiObservation();
        } catch (error) { await calendar.recordFailure(); throw error; }
        finally { calendar.dispose(); }
      }
    });

  ownedTest("M12 DC-K4: shared measurements and Hybrid load setup preserve Strength targets",
    async ({ page, actor, freshUser }) => {
      stage("m12-01");
      const { ctx, resolveMovement } = await prepareNativeMeasurements(actor);
      const bench = resolveMovement("bench")!;
      const startedOn = addDaysToYmd(today(), (7 - weekday()) % 7);
      const strengthInput = nativeTemplateInput({
        engine: tacticalBarbellEngine, ctx, resolveMovement, kind: "strength", weekdays: [0, 3], startedOn,
        values: { templateId: "fighter", blocks: 1, cluster: ["bench", "squat"], useTemplateDefaults: false,
          useTrainingMax: true, tmPercent: 0.9 },
      });
      const graphSchema = z.object({ block_id: z.string().uuid(), program_instance_id: z.string().uuid() });
      const strength = graphSchema.parse(await nativeScheduleCommit(actor, "primary-create", strengthInput));
      const original = await planned(actor);
      const firstBench = (blockId: string, rows = original) => {
        const row = rows.find((candidate) => candidate.block_id === blockId &&
          candidate.prescription.items.some((item) => item.movementId === bench.movementId && item.kind === "main"));
        expect(row).toBeDefined();
        const index = row!.prescription.items.findIndex((item) => item.movementId === bench.movementId && item.kind === "main");
        const group = groupPrescriptionByMovement(row!.prescription).find((entry) => entry.itemIndices.includes(index))!;
        expect(group.movementId).toBe(bench.movementId);
        const slot = group.itemIndices.indexOf(index);
        expect(slot).toBeGreaterThanOrEqual(0);
        return { row: row!, index, slot, groupKey: group.groupKey ?? group.movementId, item: row!.prescription.items[index]! };
      };
      const selectBench = async (target: ReturnType<typeof firstBench>) => {
        await page.getByTestId("movement-navigator-open").click();
        await page.getByTestId(`movement-navigator-item-${target.groupKey}`).click();
        await page.getByTestId(`movement-dot-${target.slot}`).click();
      };
      const strengthTarget = firstBench(strength.block_id);
      expect(strengthTarget.item.meta?.programLoadBasis).toMatchObject({ kind: "one-rm", percent: 90 });
      const instances = await actor.from("program_instances").select("id,instance,setup_input")
        .eq("user_id", freshUser.userId).order("id");
      expect(instances.error).toBeNull();
      stage("m12-02"); await page.goto("/app/settings/training-maxes");
      await page.getByLabel("Horizontal press (bench) 1RM", { exact: true }).fill("110");
      await page.getByLabel("Horizontal press (bench) 1RM", { exact: true }).blur();
      await expect.poll(async () => {
        const result = await actor.from("training_maxes").select("one_rm_kg,tm_percent")
          .eq("user_id", freshUser.userId).eq("movement_id", bench.movementId).single();
        expect(result.error).toBeNull();
        return result.data ? { oneRmKg: Number(result.data.one_rm_kg), tmPercent: Number(result.data.tm_percent) } : null;
      }).toEqual({ oneRmKg: 110, tmPercent: 97 });
      expect(await planned(actor)).toEqual(original);
      const afterMeasurement = await actor.from("program_instances").select("id,instance,setup_input")
        .eq("user_id", freshUser.userId).order("id");
      expect(afterMeasurement.error).toBeNull(); expect(afterMeasurement.data).toEqual(instances.data);
      stage("m12-03"); const strengthSession = await start(page, strengthTarget.row.id);
      await selectBench(strengthTarget);
      // 110 kg 1RM -> 90% rounded to 100 kg -> the fixture's 75% set is 75 kg.
      expect(strengthTarget.item.percentTm).toBe(75);
      await expect(page.getByLabel("Weight (kg)", { exact: true })).toHaveValue("75");
      const beforeSetup = await planned(actor);
      stage("m12-04"); await page.goto("/app/program?program=green-protocol&phase=hybrid");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Training Max", exact: true }).click();
      await page.getByRole("button", { name: "85%", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.locator('input[type="date"]').fill(startedOn);
      stage("m12-05"); await page.getByRole("button", { name: "Review dates", exact: true }).click();
      const overlap = page.getByRole("checkbox", { name: "Train on these occupied days", exact: true });
      await expect(overlap).not.toBeChecked();
      await overlap.check();
      await page.getByRole("button", { name: "Save program", exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
      const hybridRead = await actor.from("program_instances").select("id,block_id")
        .eq("user_id", freshUser.userId).eq("program_id", "green-protocol").eq("status", "active").single();
      expect(hybridRead.error).toBeNull();
      const hybrid = graphSchema.parse({ block_id: hybridRead.data?.block_id, program_instance_id: hybridRead.data?.id });
      stage("m12-06"); await page.goto(`/app/plan?block=${hybrid.block_id}`);
      await page.reload();
      await page.goto(`/app/program?edit=${hybrid.block_id}`);
      await expect(page.getByRole("link", { name: "View programs", exact: true })).toHaveAttribute("href", "/app/programs");
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
      const changedRows = await planned(actor);
      expect(changedRows.filter((row) => row.block_id === strength.block_id))
        .toEqual(beforeSetup.filter((row) => row.block_id === strength.block_id));
      const hybridTarget = firstBench(hybrid.block_id, changedRows);
      expect(hybridTarget.item.meta?.programLoadBasis).toMatchObject({ kind: "one-rm", percent: 85, roundingKg: 2.5 });
      const afterSetup = await actor.from("program_instances").select("id,instance,setup_input")
        .eq("user_id", freshUser.userId).order("id");
      expect(afterSetup.error).toBeNull();
      expect(afterSetup.data!.find((row) => row.id === strength.program_instance_id))
        .toEqual(instances.data!.find((row) => row.id === strength.program_instance_id));
      expect(afterSetup.data!.find((row) => row.id === hybrid.program_instance_id)?.setup_input)
        .toMatchObject({ values: { useTrainingMax: true, tmPercent: 0.85 } });
      const sharedMax = await actor.from("training_maxes").select("one_rm_kg,tm_percent")
        .eq("user_id", freshUser.userId).eq("movement_id", bench.movementId).single();
      expect(sharedMax.error).toBeNull();
      expect(Number(sharedMax.data!.one_rm_kg)).toBe(110); expect(Number(sharedMax.data!.tm_percent)).toBe(97);
      const loads: number[] = [], sessions: string[] = [];
      stage("m12-07");
      for (const [position, target] of [strengthTarget, hybridTarget].entries()) {
        const { row, index, item } = target;
        // Hybrid: 110 * .85 -> 92.5 kg working max; 70% -> 65 kg on 2.5 kg plates.
        expect(item.percentTm).toBe(position === 0 ? 75 : 70);
        const expected = position === 0 ? 75 : 65;
        loads.push(expected);
        const sessionId = position === 0 ? strengthSession : await start(page, row.id);
        if (position === 0) { await page.goto(`/app/sessions/${sessionId}`); await page.reload(); }
        sessions.push(sessionId);
        await selectBench(target);
        await expect(page.getByLabel("Weight (kg)", { exact: true })).toHaveValue(String(expected));
        await page.getByTestId("movement-focus-log-button").click();
        await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(1);
        expect(await loggedSets(actor, sessionId)).toMatchObject([{ prescription_item_index: index }]);
        const log = await actor.from("set_logs").select("movement_id,weight_kg,target_weight_kg,prescribed")
          .eq("session_id", sessionId).single();
        expect(log.error).toBeNull();
        expect(log.data?.movement_id).toBe(bench.movementId);
        expect(Number(log.data?.weight_kg)).toBe(expected);
        expect(Number(log.data?.target_weight_kg)).toBe(expected);
        const linked = await actor.from("planned_sessions").select("block_id,completed_session_id").eq("id", row.id).single();
        expect(linked.error).toBeNull();
        expect(linked.data).toEqual({ block_id: row.block_id, completed_session_id: sessionId });
      }
      expect(loads[0]).not.toBe(loads[1]);
      expect(new Set(sessions).size).toBe(2);
      stage("m12-08"); const remaining = await actor.from("program_instances").select("id,instance,setup_input")
        .eq("user_id", freshUser.userId).order("id");
      expect(remaining.error).toBeNull(); expect(remaining.data).toEqual(afterSetup.data);
    });

  ownedTest("M13 DC-R5/DC-SW7: shared rehab attaches through Running and Swimming and logs without a swim result",
    async ({ page, actor, catalog, freshUser }) => {
      stage("m13-01");
      const selected = movement(catalog, "bench-press-flat"), running = movement(catalog, "run-easy-z2");
      await createRehabInLibrary(page, selected, "Shared rehab", actor, test.info().timeout);
      const library = await actor.from("rehab_protocols").select("id,revision,definition")
        .eq("user_id", freshUser.userId).single();
      expect(library.error).toBeNull();
      const protocolId = z.string().uuid().parse(library.data?.id);
      stage("m13-02"); const graphs: Awaited<ReturnType<typeof prepareNativeProgram>>[] = [];
      for (const kind of ["strength", "running", "hybrid"] as const) {
        graphs.push(await prepareNativeProgram(actor, { ...nativeProgramDefinition(kind, `${kind} rehab`, weekday(),
          selected.id, running.id, kind === "running" ? undefined : protocolId), weeks: 2 }, today()));
      }
      const swimming = await prepareNativeCourse(actor, today());
      const runRow = (await planned(actor)).find((row) => row.block_id === graphs[1]!.block_id)!;
      const editRunning = `/app/program/build?edit=${graphs[1]!.block_id}&workout=${runRow.id}`;
      stage("m13-03"); await page.goto(editRunning);
      await page.getByRole("combobox", { name: "Apply changes to", exact: true }).selectOption("future");
      await page.getByRole("button", { name: "Add rehab", exact: true }).click();
      await page.getByRole("combobox", { name: "Rehab protocol", exact: true }).selectOption(protocolId);
      await page.getByRole("button", { name: "Review changes", exact: true }).click();
      await expect(page.getByRole("checkbox", { name: "Keep both workouts on these dates.", exact: true })).toHaveCount(0);
      await save(page, actor, "running", test.info().timeout);
      stage("m13-04"); await page.goto(editRunning);
      await page.reload();
      await expect(page.getByRole("combobox", { name: "Rehab protocol", exact: true })).toHaveValue(protocolId);
      await expect(page.getByRole("button", { name: "Add exercise", exact: true })).toHaveCount(0);
      const original = await planned(actor);
      const bindings = await actor.from("program_rehab_bindings").select("program_instance_id,rehab_protocol_id")
        .eq("user_id", freshUser.userId);
      expect(bindings.error).toBeNull(); expect(bindings.data).toHaveLength(3);
      expect(bindings.data).toEqual(expect.arrayContaining(graphs.map((graph) => ({
        program_instance_id: graph.program_instance_id, rehab_protocol_id: protocolId,
      }))));
      for (const row of original) {
        expect(row.prescription.items.filter((item) => item.meta?.rehabProtocolId === protocolId))
          .toMatchObject([{ movementId: selected.id, reps: 5, targetWeightKg: 20,
            meta: { rehabProtocolId: protocolId, rehabProtocolRevision: library.data!.revision } }]);
      }
      stage("m13-05"); await page.goto(`/app/swim?plan=${swimming.plan.id}`);
      const rehab = page.getByRole("region", { name: "Rehab", exact: true });
      const attachedChoice = rehab.getByRole("checkbox", { name: "Shared rehab", exact: true });
      await attachedChoice.check();
      const saveAttachment = rehab.getByRole("button", { name: /^(Save changes|Saving…)$/ });
      await saveAttachment.click();
      await expect(saveAttachment).toHaveCount(0);
      await expect(attachedChoice).toBeChecked();
      await expect(attachedChoice).toBeEnabled();
      const attached = await actor.from("swim_plan_rehab_bindings").select("plan_id,rehab_protocol_id")
        .eq("user_id", freshUser.userId);
      expect(attached.error).toBeNull();
      expect(attached.data).toEqual([{ plan_id: swimming.plan.id, rehab_protocol_id: protocolId }]);
      const courseRows = async () => {
        const result = await actor.from("swim_workouts").select("id,scheduled_date,definition,status,session_id")
          .eq("user_id", freshUser.userId).eq("plan_id", swimming.plan.id).order("scheduled_date");
        expect(result.error).toBeNull(); expect(result.data).toHaveLength(3);
        return result.data!;
      };
      const swims = await courseRows(), first = swims[0]!;
      stage("m13-06"); await page.goto(`/app/swim/${first.id}`);
      const posted = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
      await page.getByRole("button", { name: "Start Shared rehab", exact: true }).click();
      await expect(page).toHaveURL(/\/app\/sessions\/[0-9a-f-]{36}$/);
      const sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
      const request = await posted;
      const replay = await page.request.post(request.url(), { headers: request.headers(), data: request.postDataBuffer()! });
      expect(replay.ok()).toBe(true); expect(await replay.text()).toContain(sessionId);
      stage("m13-07"); await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(1);
      await page.getByRole("button", { name: /^Finish session/ }).click();
      await expect.poll(async () => {
        const result = await actor.from("sessions").select("completed_at").eq("user_id", freshUser.userId).eq("id", sessionId).single();
        expect(result.error).toBeNull(); return result.data?.completed_at !== null && result.data?.completed_at !== undefined;
      }).toBe(true);
      const session = await actor.from("sessions").select("id,prescription").eq("user_id", freshUser.userId).single();
      expect(session.error).toBeNull();
      expect(session.data).toMatchObject({ id: sessionId, prescription: { meta: { swimRehab: {
        planId: swimming.plan.id, workoutId: first.id, protocolId, protocolRevision: library.data!.revision,
        scheduledDate: first.scheduled_date,
      } } } });
      expect(await courseRows()).toEqual(swims);
      const nativeResults = await actor.from("cardio_logs").select("id").eq("session_id", sessionId);
      expect(nativeResults.error).toBeNull(); expect(nativeResults.data).toEqual([]);
      stage("m13-08"); await page.goto(`/app/swim/${first.id}`);
      await expect(page.getByRole("link", { name: "View rehab", exact: true })).toHaveAttribute("href", `/app/sessions/${sessionId}`);
      await page.goto("/app/sessions");
      await expect(page.locator(`a[href="/app/sessions/${sessionId}"]`)).toHaveCount(1);
      const receipts = await actor.from("engine_override_events").select("id").eq("user_id", freshUser.userId)
        .eq("context->>kind", "swim-rehab-start-v1");
      expect(receipts.error).toBeNull(); expect(receipts.data).toHaveLength(1);
      expect(await planned(actor)).toEqual(original);
    });

  ownedTest("M14 DC-R5/DC-SW7: Swimming pause moves only its dates and retains issued rehab",
    async ({ page, actor, catalog, freshUser }) => {
      const selected = movement(catalog, "bench-press-flat"), running = movement(catalog, "run-easy-z2");
      await createRehabInLibrary(page, selected, "Retained rehab", actor, undefined, "m14");
      const graphs: Awaited<ReturnType<typeof prepareNativeProgram>>[] = [];
      for (const kind of ["strength", "running", "hybrid"] as const) {
        graphs.push(await prepareNativeProgram(actor, { ...nativeProgramDefinition(kind, `${kind} peer`, weekday(),
          selected.id, running.id), weeks: 2 }, today()));
      }
      const swimming = await prepareNativeCourse(actor, today()), original = await planned(actor);
      await page.goto(`/app/swim?plan=${swimming.plan.id}`);
      const rehab = page.getByRole("region", { name: "Rehab", exact: true });
      await rehab.getByRole("checkbox", { name: "Retained rehab", exact: true }).check();
      await rehab.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(rehab.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
      const courseRows = async () => {
        const result = await actor.from("swim_workouts").select("id,scheduled_date,definition,status,session_id")
          .eq("user_id", freshUser.userId).eq("plan_id", swimming.plan.id).order("scheduled_date");
        expect(result.error).toBeNull(); expect(result.data).toHaveLength(3);
        return result.data!;
      };
      const swims = await courseRows(), first = swims[0]!;
      await page.goto(`/app/swim/${first.id}`);
      await page.getByRole("button", { name: "Start Retained rehab", exact: true }).click();
      await expect(page).toHaveURL(/\/app\/sessions\/[0-9a-f-]{36}$/);
      const sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(1);
      const session = await actor.from("sessions").select("id,prescription").eq("user_id", freshUser.userId).single();
      expect(session.error).toBeNull();
      await page.goto(`/app/swim?plan=${swimming.plan.id}`);
      await openSwimProgramActions(page);

      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(page.getByRole("button", { name: "Preview dates", exact: true })).toBeVisible();
      expect(await planned(actor)).toEqual(original);
      await page.getByLabel("Resume from", { exact: true }).fill(addDaysToYmd(today(), 7));
      await page.getByRole("button", { name: "Preview dates", exact: true }).click();
      const resume = page.getByRole("button", { name: "Accept dates and resume", exact: true });
      await expect(resume).toBeDisabled();
      await page.getByRole("checkbox", { name: "Keep both workouts on these dates", exact: true }).check();
      await resume.click();
      await openSwimProgramActions(page);

      await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
      const resumed = await courseRows();
      expect(resumed.map((row) => row.scheduled_date)).toEqual(swims.map((row) => addDaysToYmd(row.scheduled_date, 7)));
      expect(resumed.map((row, index) => ({ ...row, scheduled_date: swims[index]!.scheduled_date }))).toEqual(swims);
      expect(await planned(actor)).toEqual(original);
      const peers = await actor.from("training_blocks").select("id,status").eq("user_id", freshUser.userId).order("id");
      expect(peers.error).toBeNull(); expect(peers.data).toHaveLength(3);
      expect(peers.data).toEqual(expect.arrayContaining(graphs.map((graph) => ({ id: graph.block_id, status: "active" }))));
      const retained = await actor.from("sessions").select("id,prescription").eq("user_id", freshUser.userId).single();
      expect(retained.error).toBeNull(); expect(retained.data).toEqual(session.data);
      const receipts = await actor.from("engine_override_events").select("id").eq("user_id", freshUser.userId)
        .eq("context->>kind", "swim-rehab-start-v1");
      expect(receipts.error).toBeNull(); expect(receipts.data).toHaveLength(1);
    });

  ownedTest("M15 DC-K4/DC-SW8: app replacement preserves unfinished work and queued completion identities",
    async ({ page, context, browser, baseURL, actor, catalog, freshUser }) => {
      const liftId = movement(catalog, "bench-press-flat").id, runId = movement(catalog, "run-easy-z2").id;
      const strength = await prepareNativeProgram(actor,
        nativeProgramDefinition("strength", "Offline strength", weekday(), liftId, runId), today());
      const running = await prepareNativeProgram(actor,
        nativeProgramDefinition("running", "Running completion", weekday(), liftId, runId), today());
      const hybrid = await prepareNativeProgram(actor,
        nativeProgramDefinition("hybrid", "Unchanged hybrid", weekday(), liftId, runId), today());
      const swimming = await prepareNativeCourse(actor, today());
      const original = await planned(actor);
      const unfinished = await context.newPage();
      const hybridRow = original.find((row) => row.block_id === hybrid.block_id)!;
      const hybridSession = await start(unfinished, hybridRow.id);
      await unfinished.getByTestId("cardio-log-submit").click();
      await expect.poll(async () => {
        const result = await actor.from("cardio_logs").select("id").eq("session_id", hybridSession);
        expect(result.error).toBeNull(); return result.data?.length;
      }).toBe(1);
      await unfinished.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, hybridSession)).length).toBe(1);
      const unfinishedSets = await loggedSets(actor, hybridSession);
      const writerContext = await browser.newContext({ baseURL, storageState: await context.storageState(),
        viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });
      try {
        const oldRow = original.find((row) => row.block_id === strength.block_id)!;
        const oldSession = await start(page, oldRow.id);
        await page.getByTestId("movement-focus-log-button").click();
        await expect.poll(async () => (await loggedSets(actor, oldSession)).length).toBe(1);
        await context.setOffline(true);
        await page.getByRole("button", { name: /^Finish session/ }).click();
        await expect(page.getByTestId("finish-saved-offline")).toBeVisible();
        const queued = await readNativeOutbox(page);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ op: "complete", sessionId: oldSession });
        const pending = await actor.from("sessions").select("completed_at").eq("id", oldSession).single();
        expect(pending.error).toBeNull(); expect(pending.data?.completed_at).toBeNull();
        const writer = await writerContext.newPage();
        await begin(writer, "strength", "Replacement while offline");
        await lift(writer, movement(catalog, "bench-press-flat"));
        await review(writer);
        await writer.getByRole("checkbox", { name: "Keep both workouts on these dates.", exact: true }).check();
        const replacementId = await save(writer, actor, "strength", undefined, "Offline strength");
        expect(await readNativeOutbox(page)).toEqual(queued);
        expect(await loggedSets(actor, hybridSession)).toEqual(unfinishedSets);
        const beforeReplay = await actor.from("program_instances").select("id,block_id,status,instance")
          .eq("user_id", freshUser.userId).order("id");
        expect(beforeReplay.error).toBeNull();
        const posted = context.waitForEvent("request", (request) => request.method() === "POST" &&
          !!request.headers()["next-action"] && !!request.postData()?.includes(queued[0]!.id));
        await context.setOffline(false);
        const request = await posted;
        await expect.poll(async () => {
          const result = await actor.from("sessions").select("completed_at,completion_outbox_entry_id")
            .eq("user_id", freshUser.userId).eq("id", oldSession).single();
          expect(result.error).toBeNull();
          return result.data?.completed_at ? result.data.completion_outbox_entry_id : null;
        }).toBe(queued[0]!.id);
        await expect.poll(async () => (await readNativeOutbox(page)).length).toBe(0);
        const replay = await page.request.post(request.url(), { headers: request.headers(), data: request.postDataBuffer()! });
        expect(replay.ok()).toBe(true);
        const afterReplay = await actor.from("program_instances").select("id,block_id,status,instance")
          .eq("user_id", freshUser.userId).order("id");
        expect(afterReplay.error).toBeNull(); expect(afterReplay.data).toEqual(beforeReplay.data);
        const replacementRows = (await planned(actor)).filter((row) => row.block_id === replacementId);
        expect(replacementRows).toHaveLength(2);
        expect(replacementRows.every((row) => row.completed_session_id === null)).toBe(true);
        await unfinished.reload();
        await expect(unfinished).toHaveURL(new RegExp(`/app/sessions/${hybridSession}$`));
        expect(await loggedSets(actor, hybridSession)).toEqual(unfinishedSets);
        const retained = await actor.from("sessions").select("id,completed_at").eq("id", hybridSession).single();
        expect(retained.error).toBeNull(); expect(retained.data).toEqual({ id: hybridSession, completed_at: null });
        const linked = await planned(actor);
        expect(linked.find((row) => row.id === hybridRow.id)?.completed_session_id).toBe(hybridSession);
        expect(linked.find((row) => row.id === oldRow.id)?.completed_session_id).toBe(oldSession);
        expect(linked.find((row) => row.block_id === running.block_id))
          .toEqual(original.find((row) => row.block_id === running.block_id));
        const swims = await actor.from("swim_workouts").select("id,session_id").eq("plan_id", swimming.plan.id);
        expect(swims.error).toBeNull(); expect(swims.data).toHaveLength(3);
        expect(swims.data!.every((row) => row.session_id === null)).toBe(true);
        const exported = await page.request.get("/api/me/export");
        expect(exported.status()).toBe(200);
        const history = z.object({
          training_blocks: z.array(z.object({ id: z.string(), status: z.string() })),
          sessions: z.array(z.object({ id: z.string(), completed_at: z.string().nullable(),
            completion_outbox_entry_id: z.string().nullable() })),
          planned_sessions: z.array(z.object({ id: z.string(), block_id: z.string(), completed_session_id: z.string().nullable() })),
        }).parse(await exported.json());
        expect(history.training_blocks).toEqual(expect.arrayContaining([
          { id: strength.block_id, status: "archived" }, { id: replacementId, status: "active" },
        ]));
        expect(history.sessions).toEqual(expect.arrayContaining([
          { id: oldSession, completed_at: expect.any(String), completion_outbox_entry_id: queued[0]!.id },
          { id: hybridSession, completed_at: null, completion_outbox_entry_id: null },
        ]));
        expect(history.planned_sessions).toEqual(expect.arrayContaining([
          { id: oldRow.id, block_id: strength.block_id, completed_session_id: oldSession },
          { id: hybridRow.id, block_id: hybrid.block_id, completed_session_id: hybridSession },
        ]));
      } finally {
        await context.setOffline(false);
        await unfinished.close();
        await writerContext.close();
      }
    });

  ownedTest("M16 DC-K4/DC-SW8: independent completion exports retained history without fabricated swim results",
    async ({ page, actor, catalog }) => {
      const liftId = movement(catalog, "bench-press-flat").id, runId = movement(catalog, "run-easy-z2").id;
      const strength = await prepareNativeProgram(actor,
        nativeProgramDefinition("strength", "Export strength", weekday(), liftId, runId), today());
      const running = await prepareNativeProgram(actor,
        nativeProgramDefinition("running", "Running completion", weekday(), liftId, runId), today());
      const hybrid = await prepareNativeProgram(actor,
        nativeProgramDefinition("hybrid", "Unchanged hybrid", weekday(), liftId, runId), today());
      const swimming = await prepareNativeCourse(actor, today()), original = await planned(actor);
      const oldRow = original.find((row) => row.block_id === strength.block_id)!;
      const oldSession = await start(page, oldRow.id);
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, oldSession)).length).toBe(1);
      const replacement = await prepareNativeProgram(actor,
        nativeProgramDefinition("strength", "Export replacement", weekday(), liftId, runId), today(), strength.block_id);
      await page.getByRole("button", { name: /^Finish session/ }).click();
      await expect(page).toHaveURL(new RegExp(`/app/sessions/${oldSession}\\?completed=1$`));
      await expect.poll(async () => {
        const result = await actor.from("sessions").select("completion_outbox_entry_id,completed_at").eq("id", oldSession).single();
        expect(result.error).toBeNull(); return result.data?.completed_at ? result.data.completion_outbox_entry_id : null;
      }).toMatch(/^[0-9a-f-]{36}$/);
      const completed = await actor.from("sessions").select("completion_outbox_entry_id").eq("id", oldSession).single();
      expect(completed.error).toBeNull();
      const completionId = z.string().uuid().parse(completed.data?.completion_outbox_entry_id);
        const runRow = original.find((row) => row.block_id === running.block_id)!;
        const runSession = await start(page, runRow.id);
        await page.getByTestId("cardio-log-submit").click();
        await expect.poll(async () => {
          const result = await actor.from("cardio_logs").select("id").eq("session_id", runSession);
          expect(result.error).toBeNull(); return result.data?.length;
        }).toBe(1);
        await page.getByRole("button", { name: /^Finish session/ }).click();
        await expect.poll(async () => {
          const result = await actor.from("training_blocks").select("status").eq("id", running.block_id).single();
          expect(result.error).toBeNull(); return result.data?.status;
        }).toBe("completed");
        const finished = await actor.from("program_instances").select("status").eq("id", running.program_instance_id).single();
        expect(finished.error).toBeNull(); expect(finished.data?.status).toBe("archived");
        await page.goto("/app/sessions");
        for (const id of [oldSession, runSession]) await expect(page.locator(`a[href="/app/sessions/${id}"]`)).toHaveCount(1);
        const exported = await page.request.get("/api/me/export");
        expect(exported.status()).toBe(200);
        const history = z.object({
          independent_programs_available: z.literal(true),
          training_blocks: z.array(z.object({ id: z.string().uuid(), program_kind: z.string(), status: z.string() })),
          program_instances: z.array(z.object({ id: z.string().uuid(), block_id: z.string().uuid(), status: z.string() })),
          planned_sessions: z.array(z.object({ id: z.string().uuid(), block_id: z.string().uuid(), completed_session_id: z.string().uuid().nullable() })),
          sessions: z.array(z.object({ id: z.string().uuid(), completed_at: z.string(), completion_outbox_entry_id: z.string().uuid() })),
          set_logs: z.array(z.object({ session_id: z.string().uuid(), movement_id: z.string().uuid() })),
          cardio_logs: z.array(z.object({ session_id: z.string().uuid(), swim_result: z.unknown().nullable() })),
          swim_plans: z.array(z.object({ id: z.string().uuid(), status: z.string() })),
          swim_workouts: z.array(z.object({ id: z.string().uuid(), session_id: z.null(), status: z.literal("scheduled") })),
        }).parse(await exported.json());
        expect(history.training_blocks).toHaveLength(4);
        expect(history.training_blocks).toEqual(expect.arrayContaining([
          { id: strength.block_id, program_kind: "strength", status: "archived" },
          { id: replacement.block_id, program_kind: "strength", status: "active" },
          { id: running.block_id, program_kind: "running", status: "completed" },
          { id: hybrid.block_id, program_kind: "hybrid", status: "active" },
        ]));
        expect(history.program_instances).toHaveLength(4);
        expect(history.program_instances.find((row) => row.block_id === replacement.block_id))
          .toEqual({ id: replacement.program_instance_id, block_id: replacement.block_id, status: "active" });
        expect(history.planned_sessions).toHaveLength(4);
        expect(history.planned_sessions.find((row) => row.id === oldRow.id)?.completed_session_id).toBe(oldSession);
        expect(history.sessions).toHaveLength(2);
        expect(history.sessions.find((row) => row.id === oldSession)?.completion_outbox_entry_id).toBe(completionId);
        expect(history.set_logs).toEqual([{ session_id: oldSession, movement_id: liftId }]);
        expect(history.cardio_logs).toEqual([{ session_id: runSession, swim_result: null }]);
        expect(history.swim_plans).toEqual([{ id: swimming.plan.id, status: "active" }]);
        expect(history.swim_workouts.map((row) => row.id).sort()).toEqual(swimming.workouts.map((row) => row.id).sort());
        expect(history.planned_sessions.find((row) => row.block_id === hybrid.block_id)).toEqual({
          id: original.find((row) => row.block_id === hybrid.block_id)!.id, block_id: hybrid.block_id, completed_session_id: null,
        });
    });

  ownedTest("M17 DC-K4: completed advice and roadmap continuation survive a stale save and exact replay",
    async ({ page, actor, catalog, freshUser }) => {
      const { ctx, resolveMovement } = await prepareNativeMeasurements(actor);
      const input = nativeTemplateInput({
        engine: greenProtocolEngine, ctx, resolveMovement, kind: "hybrid", weekdays: [0, 2, 4], startedOn: today(),
        startWeekIndex: getGreenPhase("capacity")!.weeks.length - 1,
        values: { phaseId: "capacity", blocks: 1, useTrainingMax: false },
      });
      const source = z.object({ block_id: z.string().uuid() }).parse(await nativeScheduleCommit(actor, "primary-create", input));
      const sourceRows = (await planned(actor)).filter((row) => row.block_id === source.block_id)
        .sort((a, b) => a.week_index - b.week_index || a.day_index - b.day_index);
      expect(sourceRows).toHaveLength(3);
      for (const row of sourceRows.slice(0, -1)) await nativeScheduleCommit(actor, "primary-skip", { id: row.id });
      const terminal = sourceRows.at(-1)!;
      expect(terminal.prescription.items).toHaveLength(1);
      expect(terminal.prescription.items[0]?.kind).toBe("cardio_external");
      await start(page, terminal.id);
      await page.getByTestId("cardio-external-mark-complete-0").click();
      await expect(page).toHaveURL(/\/app$/);
      const complete = await actor.from("training_blocks").select("status").eq("id", source.block_id).single();
      expect(complete.error).toBeNull(); expect(complete.data?.status).toBe("completed");
      const adviceResult = await actor.from("program_recommendations").select("id,status,data")
        .eq("user_id", freshUser.userId).eq("block_id", source.block_id).eq("kind", "next-block").single();
      expect(adviceResult.error).toBeNull();
      const advice = z.object({ id: z.string().uuid(), status: z.literal("pending"),
        data: z.object({ programId: z.literal("green-protocol"), nextPhaseId: z.literal("velocity") }) }).parse(adviceResult.data);
      const advance = page.getByRole("link", { name: /Set up Velocity/ });
      await expect(advance).toHaveAttribute("href", new RegExp(`recommendation=${advice.id}`));
      const recommendationHref = await advance.getAttribute("href");
      await advance.click();
      await expect(page.getByTestId("loadout-opt-velocity")).toBeVisible();
      await page.goto("/app");
      await expect(advance).toBeVisible();
      const liftId = movement(catalog, "bench-press-flat").id, runId = movement(catalog, "run-easy-z2").id;
      const strength = await prepareNativeProgram(actor,
        { ...nativeProgramDefinition("strength", "Roadmap peer strength", 0, liftId, runId), weeks: 3 }, today());
      const running = await prepareNativeProgram(actor,
        { ...nativeProgramDefinition("running", "Roadmap peer running", 2, liftId, runId), weeks: 3 }, today());
      const swimming = await prepareNativeCourse(actor, today());
      const peers = (await planned(actor)).filter((row) => row.block_id !== source.block_id);
      const swimBefore = await actor.from("swim_workouts").select("*").eq("plan_id", swimming.plan.id).order("id");
      expect(swimBefore.error).toBeNull();
      const season = await actor.from("training_seasons").insert({ user_id: freshUser.userId, name: "Native roadmap" }).select("id").single();
      expect(season.error).toBeNull();
      const seasonId = z.string().uuid().parse(season.data?.id);
      const slots = await actor.from("season_blocks").insert([
        { user_id: freshUser.userId, season_id: seasonId, position: 0, program_id: "green-protocol",
          template_ref: "capacity", emphasis: "base", status: "active", block_id: source.block_id },
        { user_id: freshUser.userId, season_id: seasonId, position: 1, program_id: "green-protocol",
          template_ref: "velocity", emphasis: "endurance_bias", status: "planned" },
      ]).select("id,position").order("position");
      expect(slots.error).toBeNull(); expect(slots.data).toHaveLength(2);
      const nextId = z.string().uuid().parse(slots.data![1]!.id);
      await page.goto(`${recommendationHref}&seasonBlockId=${nextId}`);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const linked = page.getByRole("checkbox", { name: "Link to season roadmap", exact: true });
      await expect(linked).toBeChecked();
      const date = addDaysToYmd(today(), (7 - weekday()) % 7 + 7);
      const startDate = page.locator('input[type="date"]').first();
      await startDate.fill(date);
      const preview = async () => {
        await page.getByRole("button", { name: "Review dates", exact: true }).click();
        await expect(page.getByRole("region", { name: "Review program dates", exact: true })).toBeVisible();
        await page.getByRole("checkbox", { name: "Train on these occupied days", exact: true }).check();
      };
      await preview();
      const changed = await actor.from("season_blocks").update({ intent_note: "Changed in another tab" })
        .eq("user_id", freshUser.userId).eq("id", nextId).select("id").single();
      expect(changed.error).toBeNull();
      await page.getByRole("button", { name: "Save program", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      const pending = await actor.from("program_recommendations").select("status").eq("id", advice.id).single();
      expect(pending.error).toBeNull(); expect(pending.data?.status).toBe("pending");
      const noSuccessor = await actor.from("training_blocks").select("id").eq("program_kind", "hybrid").eq("status", "active");
      expect(noSuccessor.error).toBeNull(); expect(noSuccessor.data).toEqual([]);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(startDate).toHaveValue(date);
      const stillPlanned = await actor.from("season_blocks").select("status,block_id").eq("id", nextId).single();
      expect(stillPlanned.error).toBeNull(); expect(stillPlanned.data).toEqual({ status: "planned", block_id: null });
      await expect(linked).toBeChecked();
      await preview();
      const posted = page.waitForRequest((request) => request.method() === "POST" && !!request.headers()["next-action"]);
      await page.getByRole("button", { name: "Save program", exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
      const successor = await actor.from("training_blocks").select("id").eq("program_kind", "hybrid")
        .eq("user_id", freshUser.userId).eq("status", "active").single();
      expect(successor.error).toBeNull();
      const successorId = z.string().uuid().parse(successor.data?.id);
      const request = await posted;
      const replay = await page.request.post(request.url(), { headers: request.headers(), data: request.postDataBuffer()! });
      expect(replay.ok()).toBe(true); expect(await replay.text()).toContain(successorId);
      const accepted = await actor.from("program_recommendations").select("status").eq("id", advice.id).single();
      expect(accepted.error).toBeNull(); expect(accepted.data?.status).toBe("accepted");
      const roadmap = await actor.from("season_blocks").select("id,status,block_id").eq("season_id", seasonId).order("position");
      expect(roadmap.error).toBeNull();
      expect(roadmap.data).toEqual([
        { id: slots.data![0]!.id, status: "done", block_id: source.block_id },
        { id: nextId, status: "active", block_id: successorId },
      ]);
      expect((await planned(actor)).filter((row) => [strength.block_id, running.block_id].includes(row.block_id))).toEqual(peers);
      const swimAfter = await actor.from("swim_workouts").select("*").eq("plan_id", swimming.plan.id).order("id");
      expect(swimAfter.error).toBeNull(); expect(swimAfter.data).toEqual(swimBefore.data);
      const successors = await actor.from("training_blocks").select("id,started_on").eq("user_id", freshUser.userId)
        .eq("program_kind", "hybrid").eq("status", "active");
      expect(successors.error).toBeNull(); expect(successors.data).toEqual([{ id: successorId, started_on: date }]);
      const receipt = await actor.from("engine_override_events").select("id,context").eq("user_id", freshUser.userId)
        .eq("context->result->>block_id", successorId).eq("context->>operation", "primary-create");
      expect(receipt.error).toBeNull(); expect(receipt.data).toHaveLength(1);
      expect(receipt.data![0]!.context).toMatchObject({ recommendationAccepted: true,
        recommendation: { id: advice.id, block_id: source.block_id }, seasonOrigin: { id: nextId } });
    });

  ownedTest("M18 DC-K4: an unrelated unlinked program save leaves the full roadmap unchanged",
    async ({ page, actor, catalog, freshUser }) => {
      await prepareNativeMeasurements(actor);
      const running = await prepareNativeProgram(actor, { ...nativeProgramDefinition("running", "Roadmap peer", 0,
        movement(catalog, "bench-press-flat").id, movement(catalog, "run-easy-z2").id), weeks: 3 }, today());
      const swimming = await prepareNativeCourse(actor, today()), peers = await planned(actor);
      const season = await actor.from("training_seasons").insert({ user_id: freshUser.userId, name: "Unchanged roadmap" })
        .select("id").single();
      expect(season.error).toBeNull();
      const seasonId = z.string().uuid().parse(season.data?.id);
      const slot = await actor.from("season_blocks").insert({ user_id: freshUser.userId, season_id: seasonId,
        position: 0, program_id: "green-protocol", template_ref: "capacity", emphasis: "base", status: "planned" })
        .select("id").single();
      expect(slot.error).toBeNull();
      const slotId = z.string().uuid().parse(slot.data?.id);
      const roadmap = async () => {
        const season = await actor.from("training_seasons").select("*").eq("user_id", freshUser.userId).order("id");
        const slots = await actor.from("season_blocks").select("*").eq("user_id", freshUser.userId).order("position");
        expect(season.error).toBeNull(); expect(slots.error).toBeNull();
        return { season: season.data, slots: slots.data };
      };
      const original = await roadmap();
      const swimBefore = await actor.from("swim_workouts").select("*").eq("plan_id", swimming.plan.id).order("id");
      expect(swimBefore.error).toBeNull();
      await page.goto(`/app/program?seasonBlockId=${slotId}`);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const linked = page.getByRole("checkbox", { name: "Link to season roadmap", exact: true });
      await expect(linked).toBeChecked();
      await linked.uncheck();
      const date = addDaysToYmd(today(), (7 - weekday()) % 7 + 7);
      const startDate = page.locator('input[type="date"]').first();
      await startDate.fill(date);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByTestId("loadout-opt-hybrid").click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(startDate).toHaveValue(date);
      await expect(linked).not.toBeChecked();
      await page.getByRole("button", { name: "Review dates", exact: true }).click();
      await expect(page.getByRole("region", { name: "Review program dates", exact: true })).toBeVisible();
      expect(await roadmap()).toEqual(original);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(startDate).toHaveValue(date);
      await expect(linked).not.toBeChecked();
      await page.getByRole("button", { name: "Review dates", exact: true }).click();
      await page.getByRole("checkbox", { name: "Train on these occupied days", exact: true }).check();
      await page.getByRole("button", { name: "Save program", exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
      await page.reload();
      const saved = await actor.from("training_blocks").select("id,started_on").eq("program_kind", "hybrid")
        .eq("user_id", freshUser.userId).eq("status", "active").single();
      expect(saved.error).toBeNull(); expect(saved.data?.started_on).toBe(date);
      const instance = await actor.from("program_instances").select("instance").eq("block_id", saved.data!.id).single();
      expect(instance.error).toBeNull(); expect(instance.data!.instance).toMatchObject({ phaseId: "hybrid" });
      expect(await roadmap()).toEqual(original);
      expect((await planned(actor)).filter((row) => row.block_id === running.block_id)).toEqual(peers);
      const swimAfter = await actor.from("swim_workouts").select("*").eq("plan_id", swimming.plan.id).order("id");
      expect(swimAfter.error).toBeNull(); expect(swimAfter.data).toEqual(swimBefore.data);
      const receipt = await actor.from("engine_override_events").select("context").eq("user_id", freshUser.userId)
        .eq("context->>operation", "primary-create").eq("context->result->>block_id", saved.data!.id).single();
      expect(receipt.error).toBeNull(); expect(receipt.data!.context.seasonOrigin).toBeNull();
    });

});
