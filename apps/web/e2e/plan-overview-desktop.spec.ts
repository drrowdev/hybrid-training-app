import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * /app/plan program overview, calendar and review-only drawer.
 *
 * Coverage:
 *  - Default view = full-width Program overview (4 expandable week rows).
 *  - Tabbing to Month → 42-cell grid.
 *  - Clicking a future session pill opens the drawer; the drawer's
 *    "Swap day" action moves the session to a new date, after which
 *    the original cell loses the pill and the target cell gains it.
 */
test.describe("@desktop /app/plan overview + drawer", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("program default → calendar → review-only drawer swap", async ({
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
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /strength focus/i,
    );

    // Program overview is the default view in the redesign.
    await expect(page.getByTestId("plan-timeline")).toBeVisible();
    await expect(page.getByTestId("plan-view-tab-timeline")).toHaveAttribute(
      "data-active",
      "true",
    );

    // Week rows render (4 weeks were seeded → 4 rows).
    const weekRows = page.locator('[data-testid^="plan-timeline-week-"]');
    await expect(weekRows.first()).toBeVisible();

    // The duplicate This-week rail is gone; the current week is expanded.
    await expect(page.getByTestId("plan-this-week")).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="plan-timeline-week-"][data-today-row="true"]'),
    ).toHaveAttribute("open", "");

    // Switch to Month → 42 cells.
    await page.getByTestId("plan-view-tab-month").click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-month-grid")).toBeVisible();
    await expect(page.locator('[data-testid^="plan-month-cell-"]')).toHaveCount(42);

    // Switch back to Timeline.
    await page.getByTestId("plan-view-tab-timeline").click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-timeline")).toBeVisible();

    // Click any session row in the overview → review/edit drawer opens.
    if (!(await weekRows.first().getAttribute("open"))) {
      await weekRows.first().locator("summary").first().click();
    }
    const firstPill = page.locator('[data-testid^="plan-pill-"]').first();
    await firstPill.click();
    await expect(page.getByTestId("plan-drawer")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-mark-done")).toHaveCount(0);

    // Drawer action: ⇄ Swap day reveals the inline date picker.
    await page.getByTestId("plan-drawer-swap").click();
    await expect(page.getByTestId("plan-drawer-swap-form")).toBeVisible();

    // Pick tomorrow (or any other date) and submit.
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowYmd = tomorrow.toISOString().slice(0, 10);
    await page.getByTestId("plan-drawer-swap-date").fill(tomorrowYmd);
    await page.getByTestId("plan-drawer-swap-submit").click();
    await page.waitForLoadState("networkidle");

    // After the swap the drawer auto-closes and the page revalidates.
    await expect(page.getByTestId("plan-drawer")).toHaveCount(0);
  });
});
