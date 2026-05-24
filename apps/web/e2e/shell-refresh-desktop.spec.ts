import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Shell refresh — desktop chrome.
 *
 * Asserts the new layout shape:
 *   - Top nav is rendered (the `app-topbar` testid is preserved from
 *     the prior PR's status spec).
 *   - The four primary tabs are visible and clicking Plan navigates +
 *     promotes that tab to active.
 *   - The old left sidebar (`cp-sidebar`) is gone.
 *   - The right-rail Training Maxes card no longer renders on /app.
 */

test.describe("@desktop shell refresh", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("top nav + tabs render, sidebar + right rail removed", async ({
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

    // Top nav is present.
    const topbar = page.getByTestId("app-topbar");
    await expect(topbar).toBeVisible();

    // All four primary tabs are visible.
    await expect(page.getByTestId("topnav-tab-today")).toBeVisible();
    await expect(page.getByTestId("topnav-tab-plan")).toBeVisible();
    await expect(page.getByTestId("topnav-tab-stats")).toBeVisible();
    await expect(page.getByTestId("topnav-tab-settings")).toBeVisible();

    // The old left sidebar should not exist.
    expect(await page.locator(".cp-sidebar").count()).toBe(0);

    // The right-rail Training Maxes card no longer renders on /app — the
    // card uses the heading "Training maxes".
    await expect(
      page.getByRole("heading", { name: /Training maxes/i }),
    ).toHaveCount(0);

    // Today tab is active by default.
    await expect(page.getByTestId("topnav-tab-today")).toHaveAttribute(
      "data-active",
      "true",
    );

    // Click Plan → URL updates + Plan tab takes the active state.
    await page.getByTestId("topnav-tab-plan").click();
    await expect(page).toHaveURL(/\/app\/plan$/);
    await expect(page.getByTestId("topnav-tab-plan")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("topnav-tab-today")).toHaveAttribute(
      "data-active",
      "false",
    );

    // The mobile bottom tab bar is rendered (in the DOM) but hidden by
    // CSS at desktop widths.
    const bottom = page.getByTestId("bottom-tabbar");
    await expect(bottom).toHaveCount(1);
    await expect(bottom).toBeHidden();
  });
});
