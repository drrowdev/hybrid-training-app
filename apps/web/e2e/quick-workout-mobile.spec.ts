import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Quick Strength workout — mobile chrome.
 *
 * Guards the mobile UX sweep:
 *   - A fresh Quick Strength session shows ONE prominent, tappable
 *     "Pick movements to start logging" trigger (no separate dashed
 *     pill, no empty cardio card).
 *   - Tapping it opens straight into the strength catalog picker — the
 *     redundant Strength|Cardio chooser is skipped because the session
 *     modality is already known.
 *   - Adding a movement renders its card and clears the empty-state
 *     prompt.
 */

test.describe("@mobile quick strength workout", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("prominent empty-state opens straight to the strength picker", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Start a Quick Strength workout → redirect to the session page.
    await page.getByTestId("quick-workout-card").click();
    await page.getByTestId("quick-tile-strength").click();
    await page.waitForURL(/\/app\/sessions\/.+/);

    const trigger = page.getByTestId("add-to-workout-open");
    await trigger.waitFor({ state: "visible", timeout: 20000 });

    // The trigger IS the empty-state card (prominent), not a tiny pill.
    await expect(trigger).toContainText("Pick movements to start logging");

    // No empty cardio section on a pure-strength session.
    await expect(page.getByTestId("cardio-section")).toHaveCount(0);

    // Tapping opens directly into the catalog — the Strength|Cardio
    // chooser is skipped for a known-strength session.
    await trigger.click();
    await expect(page.getByTestId("add-to-workout-pick-strength")).toHaveCount(0);
    const search = page.getByPlaceholder(/search the catalog/i);
    await expect(search).toBeVisible();
    // Escape hatch to the other modality is still reachable.
    await expect(page.getByTestId("add-to-workout-switch-cardio")).toBeVisible();

    // Pick a movement → its card renders and the empty-state clears.
    await search.click();
    await search.fill("chin");
    await page.waitForTimeout(500);
    const firstResult = page.locator("ul li button").first();
    await firstResult.click();
    await page
      .locator('[data-testid^="freestyle-card-"]')
      .first()
      .waitFor({ state: "visible", timeout: 15000 });

    // Empty-state prompt is gone now that a movement exists.
    await expect(
      page.getByText("Pick movements to start logging"),
    ).toHaveCount(0);
  });
});
