import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Locator, Page } from "@playwright/test";
import type { Prescription } from "@hta/db";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { syntheticCourse } from "../src/lib/swim/__tests__/course-fixtures";
import { addDaysToYmd } from "../src/lib/dates";
import type { MODULAR_STAGE_CODES } from "../scripts/modular-browser-observations";
import { importOutcomeColumns, importOutcomeSchema } from "../src/lib/swim/import-outcomes";
import { matchColumns, matchSchema } from "../src/lib/swim/import-matching";
import { standaloneOutcomeExportSchema, standaloneOutcomeNativeQueries } from "./fixtures/standalone-outcomes";

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
    finally {
      const removed = await admin.auth.admin.deleteUser(userId);
      expect(removed.error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(userId);
      expect(remaining.data.user).toBeNull();
      expect(remaining.error?.status).toBe(404);
    }
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

function diagnosticAnnotation(type: "modular-stage" | "modular-set-indices", description: string) {
  const annotations = test.info().annotations;
  const existing = annotations.find((annotation) => annotation.type === type);
  if (existing) existing.description = description;
  else annotations.push({ type, description });
}
function stage(code: (typeof MODULAR_STAGE_CODES)["m3" | "m4"][number]) {
  diagnosticAnnotation("modular-stage", code);
}

function movement(catalog: Movement[], slug: string) {
  const selected = catalog.find((row) => row.slug === slug);
  if (!selected) throw new Error("Required library fixture missing.");
  return selected;
}
async function begin(page: Page, activity: string, name: string) {
  await page.goto(`/app/program/build?activity=${activity}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
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
async function review(page: Page) {
  await page.getByRole("button", { name: "Review program", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start program", exact: true })).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole("button", { name: /^(Start program|Save changes)$/ }).click();
  await expect(page).toHaveURL(/\/app\/plan$/);
}
async function planned(actor: SupabaseClient) {
  const result = await actor.from("planned_sessions")
    .select("id,block_id,week_index,day_index,prescription,completed_session_id").order("week_index").returns<Planned[]>();
  expect(result.error).toBeNull();
  if (!result.data) throw new Error("Saved schedule missing.");
  return result.data;
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

test.describe("Modular program builder", () => {
  test.skip(process.env.SXC_ACCEPTANCE_PROFILE !== "modular", "Requires the disposable modular acceptance profile.");
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false, hasTouch: true });

  test("M1 DC-K4: strength creation retains library identities through reload and logging", async ({ page, actor, catalog }) => {
    const selected = movement(catalog, "bench-press-flat");
    await begin(page, "strength", "Strength acceptance");
    await lift(page, selected);
    await review(page); await save(page);
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
    await run(page, selected); await review(page); await save(page);
    const rows = await planned(actor);
    const original = rows[0]!.prescription;
    expect(original.items[0]).toMatchObject({ movementId: selected.id, durationMin: 2, meta: {
      repeats: 2, intervals: [{ target: { kind: "time", seconds: 60 } }],
    } });
    await page.goto(`/app/program/build?edit=${rows[0]!.block_id}&workout=${rows[0]!.id}`);
    await page.getByLabel("Repeat sequence", { exact: true }).fill("3");
    await page.getByRole("combobox", { name: "Apply changes to", exact: true }).selectOption("future");
    await page.getByRole("button", { name: "Review changes", exact: true }).click();
    await save(page);
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
    await save(page);
    stage("m3-07");
    const rows = await planned(actor), row = rows[0]!;
    expect(row.prescription.items).toHaveLength(5);
    expect(row.prescription.items.slice(1).map((item) => item.circuit?.round)).toEqual([0, 1, 0, 1]);
    stage("m3-08");
    for (const activity of ["strength", "running"]) {
      await page.goto(`/app/programs?activity=${activity}`);
      await expect(page.locator(`a[href="/app/sessions/start/${row.id}"]`)).toBeVisible();
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
    await save(page);
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
    stage("m4-22");
    await page.getByRole("button", { name: "Finish plan", exact: true }).click();
    stage("m4-23");
    await expect.poll(async () => (await actor.from("swim_plans").select("status").single()).data?.status).toBe("finished");
    stage("m4-24");
    expect((await planned(actor)).map((row) => [row.id, row.week_index, row.day_index])).toEqual(primary.map((row) => [row.id, row.week_index, row.day_index]));
    expect((await actor.from("training_blocks").select("status").single()).data?.status).toBe("active");
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
    await save(page);
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
      await begin(page, "strength", "First private program"); await lift(page, movement(catalog, "bench-press-flat")); await review(page); await save(page);
      await begin(other, "strength", "Second private program"); await lift(other, movement(catalog, "goblet-squat")); await review(other); await save(other);
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
    } finally {
      await context.close();
      expect((await admin.auth.admin.deleteUser(secondId)).error).toBeNull();
      const remaining = await admin.auth.admin.getUserById(secondId);
      expect(remaining.data.user).toBeNull(); expect(remaining.error?.status).toBe(404);
    }
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
          : page.getByRole("region", { name: "Swimming schedule", exact: true });
        const link = scope.locator(`a[href^="/app/swim/${first.id}"]`);
        await expect(link).toBeVisible();
        await expect(link).toContainText(label);
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

});
