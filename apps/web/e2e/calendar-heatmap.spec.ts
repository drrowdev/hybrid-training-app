import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/stats — TrainingHeatmap presence smoke test.
 *
 * The component renders a 20-week × 7-day grid regardless of whether
 * the user has data, so we only need a signed-in user with an
 * onboarded profile — no block / session seeding required. Confirms
 * the testid is wired and that 140 day cells (20 × 7) plus the legend
 * are mounted on first paint.
 */

test.describe("@desktop /app/stats training heatmap", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders the calendar heatmap with 140 day cells + legend", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");

    const heatmap = page.getByTestId("training-heatmap");
    await expect(heatmap).toBeVisible();

    // 20 weeks × 7 days = 140 individual day cells (testid prefix).
    const cells = heatmap.locator('[data-testid^="heatmap-cell-"]');
    await expect(cells).toHaveCount(140);

    // Legend has all five swatches.
    await expect(page.getByTestId("training-heatmap-legend")).toContainText(/Strength/);
    await expect(page.getByTestId("training-heatmap-legend")).toContainText(/Cardio/);
    await expect(page.getByTestId("training-heatmap-legend")).toContainText(/Both/);
    await expect(page.getByTestId("training-heatmap-legend")).toContainText(/Rest/);
    await expect(page.getByTestId("training-heatmap-legend")).toContainText(/Missed/);

    // Today's cell carries the today flag for the ring outline.
    const todayCell = heatmap.locator('[data-today="true"]');
    await expect(todayCell).toHaveCount(1);
  });
});
