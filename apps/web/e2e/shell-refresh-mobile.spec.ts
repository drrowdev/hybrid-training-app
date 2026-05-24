import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Shell refresh — mobile chrome.
 *
 * Bottom tab bar is visible at 375 px and tapping a tab navigates +
 * promotes it to active. The desktop centre tabs are hidden via CSS.
 */

test.describe("@mobile shell refresh", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("bottom tab bar visible on mobile, taps navigate", async ({
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

    const bottom = page.getByTestId("bottom-tabbar");
    await expect(bottom).toBeVisible();
    await expect(page.getByTestId("bottomtab-today")).toBeVisible();
    await expect(page.getByTestId("bottomtab-plan")).toBeVisible();
    await expect(page.getByTestId("bottomtab-stats")).toBeVisible();
    await expect(page.getByTestId("bottomtab-more")).toBeVisible();

    // Today is active at /app.
    await expect(page.getByTestId("bottomtab-today")).toHaveAttribute(
      "data-active",
      "true",
    );

    // The desktop centre tabs exist in the DOM but are hidden at mobile.
    await expect(page.getByTestId("topnav-tab-today")).toBeHidden();

    // Tap Stats → URL + active state update.
    await page.getByTestId("bottomtab-stats").click();
    await expect(page).toHaveURL(/\/app\/stats$/);
    await expect(page.getByTestId("bottomtab-stats")).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});
