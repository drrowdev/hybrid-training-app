import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { chromium, expect as baseExpect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { syntheticCourse } from "../src/lib/swim/__tests__/course-fixtures";
import { ACCOUNT_FLOW_ORIGIN as origin, ACCOUNT_FLOW_SUPABASE as supabaseUrl,
  AccountFlowRefusal, demand } from "../../../packages/db/scripts/swim-account-flow-guards";
import type { NativeAccount, NativeReport } from "./swim-account-flow-browser";
import { conditioningSaveDiagnostic } from "../../../packages/db/scripts/swim-conditioning-account-flow-guards";
import { conditioningFixtureSchedule } from "./swim-conditioning-account-flow-fixture";

export const conditioningChecks = ["native_sign_in", "programme_creation", "shared_next_swim",
  "recording_confirmation", "history_and_isolation", "programme_edit_and_pause", "disconnect"] as const;
const expect = baseExpect.configure({ timeout: 20_000 });
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const shortDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const linkedSchema = z.object({
  id: z.string().uuid(), plan_id: z.string().uuid(), planned_session_id: z.string().uuid(),
  block_id: z.string().uuid(), scheduled_date: z.string(), revision: z.number().int().positive(),
  plan_status: z.string(), status: z.string(), session_id: z.string().uuid().nullable(),
  definition: z.record(z.unknown()),
});
type Linked = z.infer<typeof linkedSchema>;
async function readLinked(client: SupabaseClient, account: NativeAccount, expectedCount: number): Promise<Linked[]> {
  const result = await client.from("swim_conditioning_sessions")
    .select("id,plan_id,planned_session_id,block_id,scheduled_date,revision,plan_status,status,session_id,definition")
    .eq("user_id", account.identity.id).order("scheduled_date").limit(13);
  demand(!result.error, "linked_read");
  const rows = z.array(linkedSchema).length(expectedCount).parse(result.data);
  demand(new Set(rows.map((row) => row.block_id)).size === 1 && new Set(rows.map((row) => row.plan_id)).size === 1 &&
    new Set(rows.map((row) => row.planned_session_id)).size === expectedCount, "linked_identity");
  return rows;
}
async function layout(page: Page) {
  demand(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "layout");
}
async function navigate(page: Page, path: "/app" | "/app/plan" | "/app/settings") {
  if (new URL(page.url()).pathname !== path) await page.locator(`a[href="${path}"]:visible`).first().click();
  await expect(page).toHaveURL(new RegExp(`^${origin}${path}(?:\\?.*)?$`));
}
async function swimmingSettings(page: Page) {
  await navigate(page, "/app/settings");
  await page.getByTestId("settings-hub-swimming").click();
  await expect(page).toHaveURL(`${origin}/app/settings/swimming`);
}
async function sessions(page: Page) {
  await navigate(page, "/app");
  await page.locator('a[href="/app/sessions"]:visible').first().click();
  await expect(page).toHaveURL(`${origin}/app/sessions`);
}
async function openPlannedSwim(page: Page, workout: Linked) {
  await navigate(page, "/app/plan");
  const scheduled = page.getByTestId(`plan-pill-${workout.planned_session_id}`);
  await expect(scheduled).toHaveCount(1);
  await scheduled.click();
  const view = page.getByRole("dialog").getByRole("link", { name: "View swim", exact: true });
  await expect(view).toHaveAttribute("href", `/app/swim/${workout.id}?from=plan`);
  await view.click();
  await expect(page).toHaveURL(`${origin}/app/swim/${workout.id}?from=plan`);
}
async function setDay(page: Page, day: number, kind: "Strength" | "Conditioning" | "Rest") {
  const desired = page.getByRole("button", { name: new RegExp(`^${shortDays[day]}\\s*${kind}$`) });
  const button = page.getByRole("button", { name: new RegExp(`^${shortDays[day]}\\s*(Strength|Conditioning|Rest|Rehab)$`) });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await desired.count() === 1) return;
    await button.click();
  }
  await expect(desired).toBeVisible();
}
async function createProgramme(page: Page, slot: "a" | "b", schedule: ReturnType<typeof conditioningFixtureSchedule>, report: NativeReport) {
  const { today, swimDays, strengthDays } = schedule;
  report.journeyAccount = slot; report.journeyPhase = "loadout";
  await page.locator('a[href="/app/plan"]:visible').first().click();
  await expect(page).toHaveURL(`${origin}/app/program`);
  await page.getByTestId("program-card-tactical-barbell").click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Customize template", { exact: true }).click();
  await page.getByRole("textbox", { name: /^Program name/ }).fill(`Synthetic conditioning ${slot}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  report.journeyPhase = "benchmarks";
  const benchmarks = page.getByRole("spinbutton", { name: /1-rep max$/ });
  const count = await benchmarks.count();
  demand(count > 0 && count <= 4, "benchmark_fields");
  for (let index = 0; index < count; index++) await benchmarks.nth(index).fill("80");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  report.journeyPhase = "schedule";
  await page.getByLabel("Start date", { exact: true }).fill(today);
  for (let day = 0; day < 7; day++) {
    await setDay(page, day, swimDays.includes(day) ? "Conditioning" : strengthDays.includes(day) ? "Strength" : "Rest");
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  report.journeyPhase = "course";
  await expect(page.getByRole("heading", { name: "Conditioning", exact: true })).toBeVisible();
  for (const day of swimDays) await page.getByRole("combobox", { name: days[day], exact: true }).selectOption("swimming");
  const fixture = syntheticCourse();
  const course = { ...fixture, title: `Synthetic conditioning ${slot}`,
    weeks: Array.from({ length: 6 }, (_, index) => ({
      workouts: fixture.weeks[0]!.workouts.slice(0, swimDays.length).map((workout) => ({ ...workout, title: `Week ${index + 1}` })),
    })),
  };
  await page.getByLabel("Prepared plan file", { exact: true }).setInputFiles({
    name: "synthetic-conditioning.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(course)),
  });
  await page.getByRole("combobox", { name: "Experience", exact: true }).selectOption("regular");
  await page.getByLabel("Comfortable non-stop lengths in the plan pool", { exact: true }).fill("4");
  await page.getByRole("checkbox", { name: "Freestyle", exact: true }).check();
  await expect(page.getByRole("button", { name: "Create program", exact: true })).toBeDisabled();
  report.journeyPhase = "preview";
  await page.getByRole("button", { name: "Review swims", exact: true }).click();
  await page.getByRole("checkbox", { name: "I have reviewed the workouts, dates and pools", exact: true }).check();
  await layout(page);
  report.journeyPhase = "save";
  const save = page.getByRole("button", { name: "Create program", exact: true });
  try {
    await expect(save).toBeEnabled();
    await save.click();
    report.journeyPhase = "save_result";
    await expect(page).toHaveURL(`${origin}/app`);
  } catch (error) {
    report.saveControl = await save.count() === 1 ? await save.isEnabled() ? "enabled" : "disabled" :
      await page.getByRole("button", { name: /^Creating/ }).count() === 1 ? "pending" : "absent";
    const path = new URL(page.url()).pathname;
    report.savePage = path === "/app/program" ? "programme" : path === "/app" ? "today" : "other";
    report.saveDiagnostic = conditioningSaveDiagnostic(await page.locator('p[role="alert"]').allTextContents());
    throw error;
  }
}
export async function conditioningAccountFlow(
  accounts: readonly [NativeAccount, NativeAccount], anonKey: string, report: NativeReport, guard: () => Promise<void>,
) {
  const schedule = conditioningFixtureSchedule(new Date().toISOString().slice(0, 10));
  const { today } = schedule;
  const linked = (client: SupabaseClient, account: NativeAccount) => readLinked(client, account, schedule.workoutCount);
  const browser = await chromium.launch();
  let failure: unknown, blocked = false;
  async function step(name: typeof conditioningChecks[number], action: () => Promise<void>) {
    await guard();
    try { await action(); demand(!blocked, "browser_network"); report.checks.push({ name, status: "passed" }); }
    catch { report.checks.push({ name, status: "failed" }); throw new AccountFlowRefusal(name); }
  }
  try {
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: "block" }),
      browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }),
    ]);
    for (const context of contexts) {
      context.setDefaultTimeout(20_000);
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (++report.browserRequests > 500 || ![origin, supabaseUrl].includes(url.origin)) {
          report.networkBlock ??= report.browserRequests > 500 ? "http_limit" : "http_origin";
          blocked = true; await route.abort(); return;
        }
        await route.continue();
      });
      await context.routeWebSocket(/.*/, (socket) => {
        report.networkBlock ??= "websocket"; blocked = true; socket.close();
      });
    }
    const pages = [await contexts[0]!.newPage(), await contexts[1]!.newPage()];
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
    await step("native_sign_in", async () => {
      for (const [index, page] of pages.entries()) {
        const account = accounts[index]!;
        await page.goto(`${origin}/login?next=/app`);
        await page.getByTestId("auth-email-input").fill(account.identity.email);
        await page.getByTestId("auth-password-input").fill(account.password);
        await page.getByTestId("auth-submit").click();
        await expect(page).toHaveURL(`${origin}/app`);
        const signed = await clients[index]!.auth.signInWithPassword({ email: account.identity.email, password: account.password });
        demand(!signed.error && signed.data.user?.id === account.identity.id, "auth_identity");
      }
    });
    await step("programme_creation", async () => {
      for (const [index, page] of pages.entries()) {
        await createProgramme(page, accounts[index]!.identity.marker.slot, schedule, report);
      }
    });
    const before = await Promise.all(clients.map((client, index) => linked(client, accounts[index]!)));
    const next = before.map((rows) => {
      const row = rows.find((workout) => workout.scheduled_date === today);
      demand(row, "today_fixture"); return row;
    });
    await step("shared_next_swim", async () => {
      for (const [index, page] of pages.entries()) {
        report.journeyAccount = accounts[index]!.identity.marker.slot; report.journeyPhase = "today";
        await navigate(page, "/app");
        const view = page.getByRole("link", { name: "View swim", exact: true });
        await expect(view).toHaveAttribute("href", `/app/swim/${next[index]!.id}?from=today`);
        await view.click();
        await expect(page).toHaveURL(`${origin}/app/swim/${next[index]!.id}?from=today`);
        await layout(page);
        report.journeyPhase = "schedule";
        await navigate(page, "/app/plan");
        const scheduled = page.getByTestId(`plan-pill-${next[index]!.planned_session_id}`);
        await expect(scheduled).toHaveCount(1);
        await scheduled.click();
        const drawer = page.getByRole("dialog");
        await expect(drawer.getByRole("link", { name: "View swim", exact: true }))
          .toHaveAttribute("href", `/app/swim/${next[index]!.id}?from=plan`);
        await expect(drawer.getByRole("button", { name: /mark done/i })).toHaveCount(0);
        await page.keyboard.press("Escape");
      }
    });
    const keys: string[] = [], recordings: string[] = [];
    const receive = async (index: number) => {
      demand(++report.clientRequests <= 100, "client_transport");
      return pages[index]!.request.post(`${origin}/api/swim/import`, {
        headers: { authorization: `Bearer ${keys[index]!}`, "content-type": "application/json" },
        data: { version: 1, activity: { activity_id: "940000000001", date: today,
          type: "lap_swimming", distance_m: 350, duration_s: 900 }, detail: null },
        maxRedirects: 0, timeout: 15_000,
      });
    };
    await step("recording_confirmation", async () => {
      for (const [index, page] of pages.entries()) {
        report.journeyAccount = accounts[index]!.identity.marker.slot; report.journeyPhase = "receive";
        await swimmingSettings(page);
        await page.getByRole("button", { name: "Create import key", exact: true }).click();
        keys.push(await page.getByLabel("Import key", { exact: true }).inputValue());
        const response = await receive(index);
        demand(response.status() === 201, "import_receive");
        const receipt = z.object({ id: z.string().uuid(), revision: z.literal(1), replayed: z.literal(false) }).parse(await response.json());
        recordings.push(receipt.id);
        report.journeyPhase = "match";
        try {
          report.matchAction = "open";
          await navigate(page, "/app/settings");
          await swimmingSettings(page);
          const recording = page.locator(`a[href="/app/swim/recordings/${receipt.id}"]`);
          await expect(recording).toHaveCount(1);
          await recording.click();
          await expect(page).toHaveURL(`${origin}/app/swim/recordings/${receipt.id}`);
          report.matchAction = "date";
          await page.getByLabel("Workout date", { exact: true }).fill(today);
          report.matchAction = "search";
          await page.getByRole("button", { name: "Find workouts", exact: true }).click();
          report.matchAction = "select";
          await page.getByRole("combobox", { name: "Workout", exact: true }).selectOption(next[index]!.id);
          report.matchAction = "save";
          await page.getByRole("button", { name: "Match workout", exact: true }).click();
          report.matchAction = "result";
          await expect(page.getByRole("button", { name: "Remove match", exact: true })).toBeVisible();
        } catch (error) {
          report.matchObserved = false;
          try {
            const date = page.getByLabel("Workout date", { exact: true });
            const choice = page.getByRole("combobox", { name: "Workout", exact: true });
            const save = page.getByRole("button", { name: "Match workout", exact: true });
            report.matchDateCorrect = await date.count() === 1 && await date.inputValue({ timeout: 1000 }) === today;
            report.matchChoicePresent = await choice.locator(`option[value="${next[index]!.id}"]`).count() === 1;
            report.matchSelected = await choice.count() === 1 && await choice.inputValue({ timeout: 1000 }) === next[index]!.id;
            report.matchSaveEnabled = await save.count() === 1 && await save.isEnabled({ timeout: 1000 });
            report.matchResultPresent = await page.getByRole("button", { name: "Remove match", exact: true }).count() === 1;
            report.matchAlertPresent = await page.locator('p[role="alert"]').count() > 0;
            report.matchObserved = true;
          } catch { report.matchObserved = false; }
          throw error;
        }
        report.journeyPhase = "outcome";
        await page.getByRole("radio", { name: index === 0 ? "Completed" : "Stopped early", exact: true }).check();
        await page.getByRole("button", { name: "Confirm outcome", exact: true }).click();
        await expect(page.getByRole("button", { name: "Change outcome", exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole("button", { name: "Change outcome", exact: true })).toBeVisible();
        await layout(page);
      }
      demand(recordings.length === 2 && recordings[0] !== recordings[1], "import_identity");
    });
    await step("history_and_isolation", async () => {
      for (const [index, page] of pages.entries()) {
        report.journeyAccount = accounts[index]!.identity.marker.slot; report.journeyPhase = "sessions";
        await navigate(page, "/app/plan");
        const scheduled = page.getByTestId(`plan-pill-${next[index]!.planned_session_id}`);
        await expect(scheduled).toHaveCount(1);
        if (index === 0) await expect(scheduled).toHaveClass(/\bdone\b/);
        else {
          await expect(scheduled).not.toHaveClass(/\bdone\b/);
          await scheduled.click();
          await expect(page.getByRole("dialog").getByText("Stopped early", { exact: true })).toBeVisible();
          await page.keyboard.press("Escape");
        }
        await sessions(page);
        const entry = page.locator(`a[href="/app/swim/${next[index]!.id}?from=sessions"]`);
        await expect(entry).toHaveCount(1);
        await expect(page.getByText(index === 0 ? "Completed" : "Stopped early", { exact: true }).first()).toBeVisible();
        await entry.click();
        await page.locator(`a[href="/app/swim/recordings/${recordings[index]}?workout=${next[index]!.id}&from=sessions"]`).click();
        await expect(page.getByRole("button", { name: "Change outcome", exact: true })).toBeVisible();
        report.journeyPhase = "isolation";
        for (const table of ["swim_plans", "swim_workouts", "swim_import_outcomes", "swim_conditioning_bindings",
          "swim_conditioning_saves", "training_blocks", "planned_sessions", "program_instances"]) {
          const foreign = await clients[index]!.from(table).select("user_id")
            .eq("user_id", accounts[1 - index]!.identity.id).limit(1);
          demand(!foreign.error && foreign.data.length === 0, "foreign_read");
        }
        for (const table of ["sessions", "cardio_logs"]) {
          const native = await clients[index]!.from(table)
            .select(table === "cardio_logs" ? "id, sessions!inner(user_id)" : "id")
            .eq(table === "cardio_logs" ? "sessions.user_id" : "user_id", accounts[index]!.identity.id).limit(1);
          demand(!native.error && native.data.length === 0, "no_invented_native_results");
        }
      }
      const foreign = await clients[1]!.rpc("swim_confirm_import_outcome", {
        p_request_id: randomUUID(), p_workout_id: next[0]!.id, p_match_id: null, p_outcome: null,
        p_expected_outcome_id: null, p_expected_workout_revision: null,
      });
      demand(foreign.error?.code === "42501", "foreign_mutation");
    });
    await step("programme_edit_and_pause", async () => {
      report.journeyAccount = "a"; report.journeyPhase = "pause";
      const page = pages[0]!, client = clients[0]!, first = next[0]!;
      const unaffected = await linked(clients[1]!, accounts[1]);
      await openPlannedSwim(page, first);
      await page.getByText("Swimming options", { exact: true }).click();
      await page.getByRole("button", { name: "Pause swimming", exact: true }).click();
      await expect.poll(async () => (await linked(client, accounts[0]))[0]!.plan_status).toBe("paused");
      const frozen = await linked(client, accounts[0]);
      report.journeyPhase = "edit";
      await navigate(page, "/app/plan");
      await page.getByRole("link", { name: "Edit program", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await setDay(page, schedule.editFrom, "Rest");
      await setDay(page, schedule.editTo, "Conditioning");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`^${origin}/app/plan(?:\\?kept=today)?$`));
      const moved = await linked(client, accounts[0]);
      demand(moved.every((row) => row.plan_status === "paused") &&
        moved.some((row) => row.scheduled_date !== frozen.find((old) => old.id === row.id)!.scheduled_date) &&
        moved.every((row) => {
          const old = frozen.find((entry) => entry.id === row.id);
          return old && old.planned_session_id === row.planned_session_id && isDeepStrictEqual(old.definition, row.definition) &&
            (old.scheduled_date > today || old.scheduled_date === row.scheduled_date);
        }) && isDeepStrictEqual(await linked(clients[1]!, accounts[1]), unaffected), "paired_edit_history");
      await openPlannedSwim(page, first);
      report.journeyPhase = "resume";
      await page.getByText("Swimming options", { exact: true }).click();
      await page.getByRole("button", { name: "Resume swimming", exact: true }).click();
      await expect.poll(async () => (await linked(client, accounts[0]))[0]!.plan_status).toBe("active");
      const resumed = await linked(client, accounts[0]);
      demand(resumed.every((row) => row.scheduled_date === moved.find((old) => old.id === row.id)!.scheduled_date), "fixed_resume");
      await sessions(page);
      await expect(page.locator(`a[href="/app/swim/${first.id}?from=sessions"]`)).toHaveCount(1);
      await layout(page);
    });
    await step("disconnect", async () => {
      for (const [index, page] of pages.entries()) {
        report.journeyAccount = accounts[index]!.identity.marker.slot; report.journeyPhase = "disconnect";
        await swimmingSettings(page);
        await page.getByRole("button", { name: "Disconnect dashboard", exact: true }).click();
        await expect(page.getByRole("button", { name: "Create import key", exact: true })).toBeVisible();
        demand((await receive(index)).status() === 401, "revoked_key");
      }
    });
  } catch (error) { failure = error; }
  finally {
    try { await browser.close(); report.browserClosed = true; }
    catch { failure ??= new AccountFlowRefusal("browser_close"); }
  }
  if (failure) throw failure;
}
