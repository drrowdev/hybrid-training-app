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

  test("deletes only after confirmation and restores through Undo", async ({
    page, context, freshUser, seedConfig, admin, baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const id = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor", daysPerWeek: 3, status: "completed", startedOn: "2026-09-01",
    });
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/plan/history");
    const row = page.locator(`[data-block-id="${id}"]`);
    await expect(row).toBeVisible();

    let release!: () => void;
    let observed!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { observed = resolve; });
    await page.route("**/app/plan/history*", async (route) => {
      if (route.request().method() === "POST") {
        observed();
        await held;
      }
      await route.continue();
    });
    await row.getByTestId("block-actions-trigger").click();
    const response = page.waitForResponse((res) =>
      res.request().method() === "POST" && !!res.request().headers()["next-action"]);
    await row.getByTestId("delete-block-menu-item").click();
    await started;
    try {
      await expect(row).toBeVisible();
      await expect(page.getByTestId("undo-banner")).toHaveCount(0);
    } finally {
      release();
    }
    await (await response).finished();
    await expect(row).toHaveCount(0);
    await page.getByTestId("undo-banner-undo").click();
    await expect(row).toBeVisible();
    await page.reload();
    await expect(page.locator(`[data-block-id="${id}"]`)).toHaveCount(1);
  });

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

    await expect(page.getByRole("heading", { name: /program history/i })).toBeVisible();

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
