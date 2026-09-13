import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { chromium, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { syntheticCourse } from "../src/lib/swim/__tests__/course-fixtures";
import { ACCOUNT_FLOW_ORIGIN as origin, ACCOUNT_FLOW_SUPABASE as supabaseUrl,
  AccountFlowRefusal, demand, type AccountIdentity } from "../../../packages/db/scripts/swim-account-flow-guards";

export type NativeAccount = { identity: AccountIdentity; password: string };
export type NativeReport = {
  checks: { name: string; status: "passed" | "failed" }[];
  browserClosed: boolean; browserRequests: number; clientRequests: number;
  importPhase: "file" | "fields" | "preview" | "titles" | "commit" | "hub" | "layout" | null;
  importAccount: "a" | "b" | null;
};
const workoutSchema = z.object({
  id: z.string().uuid(), plan_id: z.string().uuid(), scheduled_date: z.string(),
  status: z.string(), revision: z.number().int(),
  definition: z.object({
    original: z.record(z.unknown()),
    issued: z.object({ budget: z.object({ minutes: z.null() }).passthrough() }).passthrough(),
    modifications: z.array(z.unknown()), courseSource: z.record(z.unknown()),
  }).passthrough(),
});
async function workouts(client: SupabaseClient, account: NativeAccount) {
  const result = await client.from("swim_workouts").select("id,plan_id,scheduled_date,status,revision,definition")
    .eq("user_id", account.identity.id).order("scheduled_date").limit(7);
  demand(!result.error, "workout_read");
  const rows = z.array(workoutSchema).length(3).parse(result.data);
  demand(new Set(rows.map((row) => row.plan_id)).size === 1 &&
    rows.every((row) => row.status !== "completed"), "workout_shape");
  return rows;
}
async function nativeSignIn(page: Page, account: NativeAccount) {
  await page.goto(`${origin}/login?next=/app/swim/import`);
  await page.getByTestId("auth-email-input").fill(account.identity.email);
  await page.getByTestId("auth-password-input").fill(account.password);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(`${origin}/app/swim/import`);
}
async function importCourse(page: Page, slot: "a" | "b", report: NativeReport) {
  report.importAccount = slot; report.importPhase = "file";
  const fixture = syntheticCourse();
  const source = {
    ...fixture, title: `Synthetic account ${slot}`,
    weeks: fixture.weeks.map((week, index) => ({
      ...week, workouts: week.workouts.map((workout) => ({ ...workout, title: `Week ${index + 1}` })),
    })),
  };
  await page.getByLabel("Prepared plan file").setInputFiles({
    name: "synthetic-course.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByRole("heading", { name: source.title, exact: true }).waitFor();
  report.importPhase = "fields";
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 14);
  await page.getByLabel("Start date", { exact: true }).fill(start.toISOString().slice(0, 10));
  await page.locator('input[name="weekdays"][value="1"]').check();
  await page.locator('input[name="weekdays"][value="3"]').check();
  await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("regular");
  await page.getByLabel("Comfortable non-stop lengths in the plan pool").fill("4");
  await page.locator('input[name="strokes"][value="freestyle"]').check();
  await expect(page.locator('input[name="timeBudgetMinutes"]')).toHaveCount(0);
  await expect(page.getByLabel("Minutes per swim", { exact: true })).toHaveCount(0);
  report.importPhase = "preview";
  await page.getByRole("button", { name: "Review plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import plan", exact: true })).toBeVisible();
  report.importPhase = "titles";
  const preview = page.locator('section[aria-labelledby="swim-plan-preview-title"]');
  await expect(preview.getByText("Week 1 A", { exact: true })).toBeVisible();
  await expect(preview.getByText("Week 1 B", { exact: true })).toBeVisible();
  report.importPhase = "commit";
  await page.locator('input[name="reviewed"]').check();
  await page.getByRole("button", { name: "Import plan", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/swim\?plan=[a-f0-9-]+$/);
  report.importPhase = "hub";
  await expect(page.getByRole("link", { name: /Week 1 A/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Week 1 B/ }).first()).toBeVisible();
  report.importPhase = "layout";
  demand(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "layout");
}
export async function nativeAccountFlow(
  accounts: readonly [NativeAccount, NativeAccount], anonKey: string, report: NativeReport, guard: () => Promise<void>,
) {
  const browser = await chromium.launch();
  let failure: unknown;
  async function step(name: string, action: () => Promise<void>) {
    await guard();
    try { await action(); report.checks.push({ name, status: "passed" }); }
    catch { report.checks.push({ name, status: "failed" }); throw new AccountFlowRefusal(name); }
  }
  try {
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" }),
      browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }),
    ]);
    let blockedRequest = false;
    for (const context of contexts) {
      context.setDefaultTimeout(20_000);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (++report.browserRequests > 500 || ![origin, supabaseUrl].includes(url.origin)) {
          blockedRequest = true; await route.abort(); return;
        }
        await route.continue();
      });
      await context.routeWebSocket(/.*/, (socket) => { blockedRequest = true; socket.close(); });
    }
    const a = await contexts[0]!.newPage(), b = await contexts[1]!.newPage();
    const clients = accounts.map(() => createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        demand(url.origin === supabaseUrl && ++report.clientRequests <= 100, "client_transport");
        return fetch(input, { ...init, redirect: "error", signal: AbortSignal.any([
          AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : []),
        ]) });
      } },
    }));
    const ca = clients[0]!, cb = clients[1]!;
    await step("native_sign_in", async () => {
      for (const [index, page] of [a, b].entries()) {
        await nativeSignIn(page, accounts[index]!);
        const signed = await clients[index]!.auth.signInWithPassword({
          email: accounts[index]!.identity.email, password: accounts[index]!.password,
        });
        demand(!signed.error && signed.data.user?.id === accounts[index]!.identity.id, "auth_identity");
      }
    });
    await step("native_course_import", async () => {
      await importCourse(a, "a", report);
      await importCourse(b, "b", report);
      demand(!blockedRequest, "browser_network");
    });
    const initialA = await workouts(ca, accounts[0]), initialB = await workouts(cb, accounts[1]);
    const first = initialA[0]!;
    await step("native_course_edit", async () => {
      await a.getByRole("link", { name: /Week 1 A/ }).first().click();
      await expect(a).toHaveURL(`${origin}/app/swim/${first.id}`);
      await a.getByText("Edit workout", { exact: true }).click();
      await a.getByLabel("Metres per repeat", { exact: true }).first().fill("100");
      await a.getByLabel("Reason for change").fill("Synthetic account-flow check");
      await a.getByRole("button", { name: "Review changes", exact: true }).click();
      await a.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect.poll(async () => (await workouts(ca, accounts[0]))[0]!.revision,
        { timeout: 15_000, intervals: [300, 600, 1000] }).toBe(first.revision + 1);
      await a.reload();
      await expect(a.getByRole("heading", { name: "Week 1 A", exact: true })).toBeVisible();
      const changed = await workouts(ca, accounts[0]);
      demand(changed[0]!.revision === first.revision + 1 &&
        changed[0]!.definition.modifications.length === 1 &&
        isDeepStrictEqual(changed[0]!.definition.original, first.definition.original) &&
        !isDeepStrictEqual(changed[0]!.definition.issued, first.definition.issued) &&
        isDeepStrictEqual(changed.slice(1), initialA.slice(1)) &&
        isDeepStrictEqual(await workouts(cb, accounts[1]), initialB), "edit_history");
    });
    const edited = await workouts(ca, accounts[0]);
    const keys: string[] = [];
    const receiptSchema = z.object({ id: z.string().uuid(), revision: z.number().int(), replayed: z.boolean() }).strict();
    const observation = {
      version: 1, activity: {
        activity_id: "930000000001", date: first.scheduled_date, type: "lap_swimming",
        distance_m: 350, duration_s: 900,
      }, detail: null,
    };
    const receive = async (page: Page, key: string, data = observation) => {
      const response = await page.request.post(`${origin}/api/swim/import`, {
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        data, maxRedirects: 0, timeout: 15_000,
      });
      return { status: response.status(), value: await response.json() };
    };
    let importA = "", importB = "";
    await step("native_connection_receive", async () => {
      for (const page of [a, b]) {
        await page.goto(`${origin}/app/settings/swimming`);
        await page.getByRole("button", { name: "Create import key", exact: true }).click();
        const input = page.getByLabel("Import key", { exact: true });
        await expect(input).toBeVisible();
        keys.push(await input.inputValue());
        await page.reload();
        await expect(page.getByLabel("Import key", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Disconnect dashboard", exact: true })).toBeVisible();
      }
      const firstA = await receive(a, keys[0]!), firstB = await receive(b, keys[1]!);
      demand(firstA.status === 201 && firstB.status === 201, "receive_status");
      const ra = receiptSchema.parse(firstA.value), rb = receiptSchema.parse(firstB.value);
      demand(ra.revision === 1 && rb.revision === 1 && !ra.replayed && !rb.replayed && ra.id !== rb.id, "receive_identity");
      importA = ra.id; importB = rb.id;
      const replay = await receive(a, keys[0]!);
      const repeated = receiptSchema.parse(replay.value);
      demand(replay.status === 200 && repeated.id === importA && repeated.replayed && repeated.revision === 1, "receive_replay");
    });
    await step("account_isolation", async () => {
      for (const table of ["swim_plans", "swim_workouts", "swim_connections", "swim_imports"]) {
        const other = await cb.from(table).select("id").eq("user_id", accounts[0].identity.id).limit(1);
        demand(!other.error && other.data.length === 0, "foreign_read");
      }
      const foreign = await b.goto(`${origin}/app/swim/${first.id}`);
      demand(foreign && [200, 404].includes(foreign.status()), "foreign_workout");
      await expect(b.getByRole("heading", { name: "404", exact: true })).toBeVisible();
      await expect(b.getByText("Edit workout", { exact: true })).toHaveCount(0);
      const mutate = await cb.rpc("swim_match_import", {
        p_request_id: randomUUID(), p_import_id: importB, p_workout_id: first.id,
        p_expected_match_id: null, p_expected_workout_revision: edited[0]!.revision,
      });
      demand(mutate.error?.code === "42501", "foreign_mutation");
      demand(isDeepStrictEqual(await workouts(ca, accounts[0]), edited) &&
        isDeepStrictEqual(await workouts(cb, accounts[1]), initialB), "foreign_unchanged");
    });
    await step("native_recording_match", async () => {
      await a.goto(`${origin}/app/swim/recordings/${importA}`);
      await a.getByLabel("Workout date", { exact: true }).fill(first.scheduled_date);
      await a.getByRole("button", { name: "Find workouts", exact: true }).click();
      await a.getByRole("combobox", { name: "Workout", exact: true }).selectOption(first.id);
      await a.getByRole("button", { name: "Match workout", exact: true }).click();
      await expect(a.getByRole("button", { name: "Remove match", exact: true })).toBeVisible();
      const correction = await receive(a, keys[0]!, {
        ...observation, activity: { ...observation.activity, duration_s: 910 },
      });
      const corrected = receiptSchema.parse(correction.value);
      demand(correction.status === 201 && corrected.revision === 2 && corrected.id !== importA && !corrected.replayed, "correction");
      await a.reload();
      await a.getByRole("button", { name: "Remove match", exact: true }).click();
      await expect(a.getByRole("button", { name: "Remove match", exact: true })).toHaveCount(0);
      const history = await ca.from("swim_import_matches").select("revision,workout_id,import_id")
        .eq("user_id", accounts[0].identity.id).order("revision").limit(3);
      demand(!history.error && history.data.length === 2 &&
        history.data[0]!.workout_id === first.id && history.data[0]!.import_id === importA &&
        history.data[1]!.workout_id === null, "match_history");
      demand(isDeepStrictEqual(await workouts(ca, accounts[0]), edited), "no_inferred_completion");
    });
    await step("native_disconnect", async () => {
      for (const [index, page] of [a, b].entries()) {
        await page.goto(`${origin}/app/settings/swimming`);
        await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).click();
        await expect(page.getByRole("button", { name: "Create import key", exact: true })).toBeVisible();
        demand((await receive(page, keys[index]!)).status === 401, "revoked_key");
      }
      demand(!blockedRequest, "browser_network");
    });
  } catch (error) { failure = error; }
  finally {
    try { await browser.close(); report.browserClosed = true; }
    catch { failure ??= new AccountFlowRefusal("browser_close"); }
  }
  if (failure) throw failure;
}
