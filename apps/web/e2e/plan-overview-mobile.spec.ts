import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

test.describe("@mobile /app/plan overview", () => {
  test("keeps the program overview available and the drawer review-only", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const today = new Date().toISOString().slice(0, 10);
    const blockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      status: "active",
      startedOn: today,
      weeks: 4,
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, blockId, {
      totalSessions: 4,
      loggedCount: 1,
    });
    await signInAs(
      context,
      freshUser,
      seedConfig,
      baseURL ?? "http://localhost:3000",
    );

    await page.goto("/app/plan");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("plan-view-tab-timeline")).toBeVisible();
    await expect(page.getByTestId("plan-timeline")).toBeVisible();
    const currentWeek = page.locator(
      '[data-testid^="plan-timeline-week-"][data-today-row="true"]',
    );
    await expect(currentWeek).toHaveAttribute("open", "");
    await expect(page.getByTestId("plan-this-week")).toHaveCount(0);
    await expect(page.getByTestId("block-controls")).toHaveCount(0);
    await page.getByTestId("program-actions-more").click();
    await expect(
      page.getByTestId("program-actions-menu").getByRole("menuitem", {
        name: "History",
      }),
    ).toBeVisible();
    await page.getByTestId("program-actions-more").click();

    const overflow = await page.evaluate(() => {
      const pageRoot = document.querySelector(
        '[data-testid="plan-redesign"]',
      ) as HTMLElement;
      return pageRoot.scrollWidth - pageRoot.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await currentWeek.locator('[data-testid^="plan-pill-"]').first().click();
    await expect(page.getByTestId("plan-drawer")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-mark-done")).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="overdue-log-"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId("plan-drawer-swap")).toBeVisible();

    await page.getByTestId("plan-drawer-close").click();
    await page.getByTestId("plan-view-tab-month").click();
    await expect(page.getByTestId("plan-month-grid")).toBeVisible();
  });
});
