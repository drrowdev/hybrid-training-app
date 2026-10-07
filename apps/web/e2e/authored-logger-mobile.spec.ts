import { test, expect, type Page } from "@playwright/test";

const URL = "/dev/logger-preview?variant=authored";
const STORE = "hta.synthetic-authored-logs";
const title = (page: Page) => page.getByTestId("focus-strip-logger").getByRole("heading", { level: 2 }).first();
const logButton = (page: Page) => page.locator('[data-testid="movement-focus-log-button"]:visible');

async function pick(page: Page, position: number) {
  await page.getByTestId("movement-navigator-open").click();
  const nav = page.getByTestId("movement-navigator");
  await expect(nav).toHaveAttribute("aria-hidden", "false");
  await nav.locator('button[data-testid^="movement-navigator-item-"]').nth(position).click();
}

async function logSet(page: Page) {
  const before = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).sets.length, STORE);
  await expect(logButton(page)).toBeEnabled();
  await logButton(page).click();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).sets.length, STORE)).toBe(before + 1);
}

test.describe("authored hybrid guided logger", () => {
  test("warm-ups, all Moves, manual jump, cardio, resume and finish share one flow", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(URL);
    await expect(title(page)).toHaveText("Bench Press");
    await expect(page.getByTestId("movement-focus-card")).toContainText(/warm-up/i);
    await expect(page.getByRole("navigation", { name: "Workout parts" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("authored-375-warmups.png"), fullPage: true });
    await page.getByTestId("movement-navigator-open").click();
    const nav = page.getByTestId("movement-navigator");
    const rows = nav.locator('button[data-testid^="movement-navigator-item-"]');
    await expect(rows).toHaveCount(13);
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(rows).toContainText([
      "Bench Press", "Weighted Pull-up", "Cable Row", "Band External Rotation", "Running",
      "Running", "Cable Row", "Running", "Cable Row", "Running", "Cable Row", "Running", "Cable Row",
    ]);
    await page.screenshot({ path: testInfo.outputPath("authored-375-moves.png"), fullPage: true });
    await page.getByTestId("movement-navigator-close").click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("authored-1280-warmups.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    for (let i = 0; i < 5; i++) await logSet(page);
    await expect(title(page)).toHaveText("Weighted Pull-up");
    await page.getByTestId("movement-navigator-open").click();
    await expect(rows.first()).toHaveAttribute("data-done", "true");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await page.getByTestId("movement-navigator-close").click();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).sets.map((set: { set_kind: string }) => set.set_kind), STORE))
      .toEqual(["warmup", "warmup", "warmup", "main", "main"]);

    // Manual navigation must not pin the just-completed movement.
    await pick(page, 2);
    await expect(title(page)).toHaveText("Cable Row");
    await logSet(page);
    await page.getByTestId("focus-strip-end-movement").click();
    await expect(title(page)).toHaveText("Band External Rotation");
    await page.getByTestId("movement-focus-skip-button").click();
    await page.getByTestId("skip-reason-time").click();
    await page.getByTestId("skip-confirm").click();
    await expect(title(page)).toHaveText("Running");
    await expect(page.getByTestId("cardio-log-toggle-skip")).toHaveCount(0);
    await page.getByTestId("cardio-log-duration").fill("6");
    await page.getByTestId("cardio-log-notes").fill("Easy pace");
    await page.reload();
    await expect(title(page)).toHaveText("Running");
    await expect(page.getByTestId("cardio-log-duration")).toHaveValue("6");
    await expect(page.getByTestId("cardio-log-notes")).toHaveValue("Easy pace");
    await page.getByTestId("cardio-log-submit").click();
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).cardio.length, STORE)).toBe(1);
    await expect(page.getByTestId("cardio-log-duration")).toHaveValue("");
    const movesBox = await page.getByTestId("movement-navigator-open").boundingBox();
    expect(movesBox!.x + movesBox!.width).toBeGreaterThan(350);
    await page.screenshot({ path: testInfo.outputPath("authored-375-cardio.png"), fullPage: true });

    await pick(page, 1);
    await expect(title(page)).toHaveText("Weighted Pull-up");
    for (let i = 0; i < 4; i++) await logSet(page);
    await expect(title(page)).toHaveText("Running");
    // The four pairs contain four runs and four station occurrences, not
    // one movement group with four sets ahead of all the runs.
    for (let pair = 0; pair < 4; pair++) {
      await expect(title(page)).toHaveText("Running");
      await page.getByTestId("cardio-log-duration").fill("1");
      await page.getByTestId("cardio-log-submit").click();
      await expect(title(page)).toHaveText("Cable Row");
      await logSet(page);
    }
    await expect(page.getByTestId("finish-stickybar")).toBeVisible();
    expect(await page.evaluate((key) => {
      const logs = JSON.parse(localStorage.getItem(key)!);
      return { strength: logs.sets.length, cardio: logs.cardio.length,
        uniqueIndices: new Set(logs.sets.map((set: { prescription_item_index: number }) => set.prescription_item_index)).size };
    }, STORE)).toEqual({ strength: 15, cardio: 5, uniqueIndices: 15 });
    await context.setOffline(true);
    await page.getByTestId("finish-stickybar").getByRole("button").click();
    await expect(page.getByTestId("finish-saved-offline")).toBeVisible();
  });

  test("failed saves keep the active slot and manual Moves preserve drafts", async ({ page }) => {
    await page.goto(`${URL}-reject`);
    await expect(title(page)).toHaveText("Bench Press");
    const weight = page.locator('[data-testid="stepper-weight"] input');
    await weight.fill("37.5");
    await weight.blur();
    await pick(page, 2);
    await expect(title(page)).toHaveText("Cable Row");
    await pick(page, 0);
    await expect(weight).toHaveValue("37.5");
    await logButton(page).click();
    await expect(page.getByTestId("focus-strip-logger").getByRole("alert")).toContainText("Synthetic save rejected");
    await expect(title(page)).toHaveText("Bench Press");
    await expect(page.getByTestId("movement-dot-0")).not.toHaveAttribute("data-logged", "true");
    await logSet(page);
    await expect(page.getByTestId("movement-dot-0")).toHaveAttribute("data-logged", "true");
    await page.getByTestId("movement-dot-0").click();
    await expect(logButton(page)).toContainText("Update set");
    await logButton(page).click();
    await expect(title(page)).toHaveText("Bench Press");
    await pick(page, 4);
    await page.getByTestId("cardio-log-duration").fill("6");
    await page.getByTestId("cardio-log-submit").click();
    await expect(page.getByTestId("cardio-log-form").getByRole("alert")).toContainText("Synthetic cardio rejected");
    await expect(page.getByTestId("cardio-log-duration")).toHaveValue("6");
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).cardio.length, STORE)).toBe(0);
    await page.getByTestId("cardio-log-submit").click();
    await expect(page.getByTestId("cardio-log-duration")).toHaveValue("");
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).cardio.length, STORE)).toBe(1);
  });
});
