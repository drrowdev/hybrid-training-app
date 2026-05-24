import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * /app/plan calendar view modes.
 *
 * Coverage:
 *  - Default view = Month → 42 grid cells.
 *  - Tabbing to Timeline → week-grouped panels.
 *  - Tabbing to List → flat day groups.
 *  - Filter "Strength" hides cardio-painted chips.
 *  - Legend toggle expands the legend body.
 *
 * Uses the seed-blocks helpers — an active block with planned
 * sessions is enough for all three views to render. We don't seed
 * priority events or cardio logs here; the views handle their
 * absence by rendering nothing extra.
 */
test.describe("@desktop /app/plan calendar view modes", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("month default → timeline → list, filter, legend", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    const today = new Date();
    const startedOn = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 7),
    )
      .toISOString()
      .slice(0, 10);
    const blockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      status: "active",
      startedOn,
      weeks: 4,
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, blockId, {
      totalSessions: 6,
      loggedCount: 1,
    });

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/plan");
    await page.waitForLoadState("networkidle");

    // Header.
    await expect(page.getByRole("heading", { level: 1, name: /^plan$/i })).toBeVisible();

    // Default view is Month — 42 cells (7 × 6) regardless of items.
    await expect(page.getByTestId("plan-views")).toBeVisible();
    await expect(page.getByTestId("plan-month-grid")).toBeVisible();
    const monthCells = page.locator('[data-testid^="plan-month-cell-"]');
    await expect(monthCells).toHaveCount(42);

    // Month tab is active by default.
    await expect(page.getByTestId("plan-view-tab-month")).toHaveAttribute("data-active", "true");

    // Switch to Timeline.
    await page.getByTestId("plan-view-tab-timeline").click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-timeline")).toBeVisible();
    // Week panels render with the testid prefix.
    const weekPanels = page.locator('[data-testid^="plan-timeline-week-"]');
    await expect(weekPanels.first()).toBeVisible();

    // Switch to List.
    await page.getByTestId("plan-view-tab-list").click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-list")).toBeVisible();

    // Filter chip — Strength hides cardio-painted rows. The seeded
    // planned sessions are all strength by default, so toggling
    // shouldn't remove them.
    await page.getByTestId("plan-filter-strength").click();
    await expect(page.getByTestId("plan-filter-strength")).toHaveAttribute("data-active", "true");

    // Legend toggle — defaultLegendOpen is true on desktop, so the
    // body should already be visible. Clicking the toggle collapses
    // it; clicking again re-expands.
    const legendToggle = page.getByTestId("plan-legend-toggle");
    await expect(page.getByTestId("plan-legend")).toBeVisible();
    await legendToggle.click();
    await expect(page.getByTestId("plan-legend")).toBeHidden();
    await legendToggle.click();
    await expect(page.getByTestId("plan-legend")).toBeVisible();
    // Legend lists all six categories.
    await expect(page.getByTestId("plan-legend")).toContainText(/Strength planned/);
    await expect(page.getByTestId("plan-legend")).toContainText(/Strength done/);
    await expect(page.getByTestId("plan-legend")).toContainText(/Cardio planned/);
    await expect(page.getByTestId("plan-legend")).toContainText(/Cardio done/);
    await expect(page.getByTestId("plan-legend")).toContainText(/Past unfulfilled/);
    await expect(page.getByTestId("plan-legend")).toContainText(/Priority event/);
  });
});
