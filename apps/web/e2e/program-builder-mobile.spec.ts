import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Locator, Page } from "@playwright/test";
import type { Prescription } from "@hta/db";
import { test as seededTest, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { swimE2EEnabled } from "./fixtures/swim-environment";
import { syntheticCourse } from "../src/lib/swim/__tests__/course-fixtures";
import { addDaysToYmd } from "../src/lib/dates";

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
    await page.getByLabel("Apply changes to", { exact: true }).selectOption("future");
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
    await begin(page, "hybrid", "Mixed acceptance");
    await run(page, running, "hybrid");
    await page.getByRole("button", { name: "Add circuit", exact: true }).click();
    const circuit = page.locator("article").last();
    await circuit.getByLabel("Rounds", { exact: true }).fill("2");
    await circuit.getByLabel("Search library", { exact: true }).first().fill(first.display_name);
    await circuit.getByRole("button", { name: first.display_name, exact: true }).first().click();
    await circuit.getByLabel("Search library", { exact: true }).fill(second.display_name);
    await circuit.getByRole("button", { name: second.display_name, exact: true }).click();
    for (const input of await circuit.getByLabel("Load (kg)", { exact: true }).all()) await input.fill("20");
    for (const input of await circuit.getByLabel("Rest (seconds)", { exact: true }).all()) await input.fill("0");
    await review(page); await save(page);
    const rows = await planned(actor), row = rows[0]!;
    expect(row.prescription.items).toHaveLength(5);
    expect(row.prescription.items.slice(1).map((item) => item.circuit?.round)).toEqual([0, 1, 0, 1]);
    for (const activity of ["strength", "running"]) {
      await page.goto(`/app/programs?activity=${activity}`);
      await expect(page.locator(`a[href="/app/sessions/start/${row.id}"]`)).toBeVisible();
    }
    const sessionId = await start(page, row.id);
    await expect(page.getByTestId("authored-workout-parts").getByRole("button")).toHaveCount(2);
    await page.getByTestId("cardio-log-submit").click();
    await expect(page.getByTestId("movement-focus-log-button")).toBeVisible();
    for (let index = 0; index < 4; index++) {
      await page.getByTestId("movement-focus-log-button").click();
      await expect.poll(async () => (await loggedSets(actor, sessionId)).length).toBe(index + 1);
    }
    expect((await loggedSets(actor, sessionId)).map((entry) => entry.prescription_item_index)).toEqual([1, 3, 2, 4]);
    const cardio = await actor.from("cardio_logs").select("block_index,movement_id,duration_sec").eq("session_id", sessionId);
    expect(cardio.error).toBeNull();
    expect(cardio.data).toEqual([{ block_index: 1, movement_id: running.id, duration_sec: 120 }]);
    await page.reload();
    expect((await planned(actor))[0]!.completed_session_id).toBe(sessionId);
    expect(await loggedSets(actor, sessionId)).toHaveLength(4);
    await expect(page.getByTestId("finish-stickybar")).toHaveAttribute("data-armed", "true");
  });

  test("M4 DC-SW7: swimming coexists with reviewed primary commitments and independent lifecycle", async ({ page, actor, catalog }) => {
    await begin(page, "strength", "Independent strength");
    await lift(page, movement(catalog, "bench-press-flat")); await review(page); await save(page);
    const primary = await planned(actor);
    await page.goto("/app/swim/import");
    const fixture = syntheticCourse(), source = { ...fixture, weeks: [fixture.weeks[0]!] };
    await page.getByLabel("Prepared plan file").setInputFiles({
      name: "synthetic-course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)),
    });
    const sunday = new Date(`${today()}T00:00:00Z`).getUTCDay();
    for (const day of [(sunday + 1) % 7, (sunday + 3) % 7]) await page.locator(`input[name="weekdays"][value="${day}"]`).check();
    await page.getByLabel("Experience", { exact: true }).selectOption("trained");
    await page.getByLabel("Comfortable non-stop lengths in the plan pool").fill("40");
    await page.getByLabel("Freestyle", { exact: true }).check();
    await page.getByRole("button", { name: "Review plan", exact: true }).click();
    await page.getByLabel("I have reviewed the workouts, dates and pools").check();
    await page.getByRole("button", { name: "Import plan", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/swim\?plan=/);
    const swims = await actor.from("swim_workouts").select("id,scheduled_date").order("scheduled_date");
    expect(swims.error).toBeNull(); expect(swims.data).toHaveLength(2);
    await page.getByText("Move swim", { exact: true }).first().click();
    const editor = page.locator("details").filter({ has: page.getByLabel("Swim date") }).first();
    await editor.getByLabel("Swim date").fill(today());
    await editor.getByLabel("Reason", { exact: true }).fill("Reviewed two-workout day");
    await editor.getByRole("button", { name: "Preview date", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Save date", exact: true })).toBeDisabled();
    await editor.getByLabel("Keep both workouts on this date").check();
    await editor.getByRole("button", { name: "Save date", exact: true }).click();
    await expect.poll(async () => (await actor.from("swim_workouts").select("scheduled_date").eq("id", swims.data![0]!.id).single()).data?.scheduled_date).toBe(today());
    expect((await actor.from("swim_workouts").select("id")).data).toHaveLength(2);
    await page.getByRole("button", { name: "Finish plan", exact: true }).click();
    await expect.poll(async () => (await actor.from("swim_plans").select("status").single()).data?.status).toBe("finished");
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
    await expect(page.getByRole("alert")).toContainText("changed");
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
});
