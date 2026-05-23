import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * Desktop /app/plan/history.
 *
 * Pre-condition: a seeded user with two blocks — one completed (with
 * a logged session) and one active. Asserts both render with the
 * right status badges + completion ratio, that the section expands,
 * and that logged sessions are linked.
 */

test.describe("@desktop /plan/history", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("lists completed + active blocks and expands sessions", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    const completedBlockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      status: "completed",
      startedOn: "2026-03-01",
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, completedBlockId, {
      totalSessions: 4,
      loggedCount: 2,
    });

    const activeBlockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "endurance_anchor",
      daysPerWeek: 5,
      status: "active",
      startedOn: "2026-05-01",
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, activeBlockId, {
      totalSessions: 5,
      loggedCount: 0,
    });

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    await page.goto("/app/plan/history");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /block history/i })).toBeVisible();

    const list = page.getByTestId("plan-history-list");
    await expect(list).toBeVisible();
    const rows = page.getByTestId("block-history-row");
    await expect(rows).toHaveCount(2);

    // Most-recent first → active endurance block on top.
    const top = rows.first();
    await expect(top).toContainText(/endurance focus/i);
    await expect(top.getByTestId("block-status-badge")).toHaveAttribute("data-status", "active");
    await expect(top).toContainText(/5 d\/wk/);
    await expect(top).toContainText(/0 of 5 sessions logged/i);

    const bottom = rows.nth(1);
    await expect(bottom).toContainText(/strength focus/i);
    await expect(bottom.getByTestId("block-status-badge")).toHaveAttribute("data-status", "completed");
    await expect(bottom).toContainText(/4 d\/wk/);
    await expect(bottom).toContainText(/2 of 4 sessions logged/i);

    // Expand the completed block — its planned_sessions list should
    // materialise. Native <details>, so clicking the summary toggles it.
    await bottom.locator("summary").click();
    await expect(bottom.getByTestId("block-history-sessions")).toBeVisible();
    // At least one of the planned sessions is logged → has a click-through link.
    const sessionLinks = bottom.getByTestId("block-history-session-link");
    await expect(sessionLinks.first()).toBeVisible();
  });
});
