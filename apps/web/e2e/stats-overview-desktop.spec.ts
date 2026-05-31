import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * Desktop /app/stats — Direction-C2 command-center redesign.
 *
 * Replaces the old flat-card-grid spec. The page is now a hero verdict
 * band (Progress · Readiness · Consistency) over a six-tile bento
 * (Strength / Endurance / Recovery & load / Consistency rhythm /
 * Bodyweight / Why today) with a bottom deep-dive link grid.
 *
 * Pre-condition (seeded via service-role admin client):
 *  - one active block + 5 completed planned sessions + 2 skipped
 *  - one bodyweight wellness entry (82.5 kg)
 *
 * The spec signs the user in, lands on /app/stats, asserts the hero +
 * every bento tile mounts, and clicks each deep-dive link to confirm
 * the routing surface is intact.
 */
test.describe("@desktop /app/stats command center", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders hero + every bento tile with seeded data + deep-dive links route correctly", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Active block — strength focus, 4 weeks × 4 days = 16 planned days.
    // Block started 14 days ago so today sits in week 2 of 4.
    const startedOn = new Date(Date.now() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const blockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      weeks: 4,
      status: "active",
      startedOn,
    });
    // Seed 8 planned sessions: 5 logged, 2 skipped, 1 untouched.
    const plannedIds = await seedPlannedSessionsForBlock(
      admin,
      freshUser.userId,
      blockId,
      { totalSessions: 8, loggedCount: 5 },
    );
    const toSkip = plannedIds.slice(5, 7);
    {
      const { error } = await admin
        .from("planned_sessions")
        .update({ skipped_at: new Date().toISOString() })
        .in("id", toSkip);
      if (error) throw new Error(`seed skipped planned: ${error.message}`);
    }

    // Wellness: one bodyweight entry.
    {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await admin
        .from("wellness")
        .upsert(
          {
            user_id: freshUser.userId,
            date: today,
            bodyweight_kg: 82.5,
          },
          { onConflict: "user_id,date" },
        );
      if (error) throw new Error(`seed wellness: ${error.message}`);
    }

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");

    // ─── Block-context strip ───────────────────────────────────────
    const activeBlock = page.getByTestId("stats-card-active-block");
    await expect(activeBlock).toBeVisible();
    await expect(activeBlock).toContainText(/Strength Focus/i);
    await expect(activeBlock).toContainText(/Week 2 of 4/i);
    await expect(activeBlock).toContainText(/Day .* of 4 days\/week/i);
    await expect(page.getByTestId("stats-active-block-completion")).toContainText(
      /5 of \d+ sessions logged/i,
    );

    // ─── Hero band (3 cells) ───────────────────────────────────────
    await expect(page.getByTestId("stats-progress-verdict")).toBeVisible();
    await expect(page.getByTestId("stats-readiness-cell")).toBeVisible();
    await expect(page.getByTestId("stats-card-adherence")).toBeVisible();
    // Hero cell labels carry the active range.
    await expect(page.getByText(/Progress · 30 days/i)).toBeVisible();
    await expect(page.getByText(/Consistency · 30 days/i)).toBeVisible();

    // ─── Bento tiles (6) ───────────────────────────────────────────
    await expect(page.getByTestId("stats-tile-strength")).toBeVisible();
    await expect(page.getByTestId("stats-tile-endurance")).toBeVisible();
    await expect(page.getByTestId("stats-card-freshness")).toBeVisible();
    await expect(page.getByTestId("stats-tile-consistency")).toBeVisible();
    await expect(page.getByTestId("stats-tile-decision-trace")).toBeVisible();

    // Bodyweight tile renders the seeded value.
    const bodyweight = page.getByTestId("stats-card-bodyweight");
    await expect(bodyweight).toBeVisible();
    await expect(bodyweight).toContainText(/82\.5/);

    // ─── Bottom deep-dive grid + routing (Phase 3 folds into drawers) ─
    const deepDives = page.getByTestId("stats-deep-dive");
    await expect(deepDives).toHaveCount(4);

    // 0: PRs & per-movement records page.
    await deepDives.nth(0).click();
    await expect(page).toHaveURL(/\/app\/stats\/prs$/);

    // 1: engine internals.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(1).click();
    await expect(page).toHaveURL(/\/app\/stats\/engine$/);

    // 2: block outcomes.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(2).click();
    await expect(page).toHaveURL(/\/app\/stats\/blocks$/);

    // 3: adherence detail (was the pre-redesign wellness mismatch).
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(3).click();
    await expect(page).toHaveURL(/\/app\/stats\/adherence$/);

    // Active-block CTA → plan history.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-active-block-cta").click();
    await expect(page).toHaveURL(/\/app\/plan\/history$/);
  });

  test("range toggle: clicking 90d / all / 30d updates the URL and the hero labels", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    const startedOn = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const blockId = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      weeks: 4,
      status: "active",
      startedOn,
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, blockId, {
      totalSessions: 4,
      loggedCount: 2,
    });

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");

    // Default landing = 30d. Toggle exists and 30d is active.
    const toggle = page.getByTestId("stats-range-toggle");
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("stats-range-option").filter({ hasText: "30 days" })).toHaveAttribute(
      "data-active",
      "true",
    );

    // Click 90 days → URL gains ?range=90d and hero label re-renders.
    await page.getByTestId("stats-range-option").filter({ hasText: "90 days" }).click();
    await expect(page).toHaveURL(/\/app\/stats\?range=90d$/);
    await expect(page.getByText(/Progress · 90 days/i)).toBeVisible();

    // Click All-time → URL gains ?range=all.
    await page.getByTestId("stats-range-option").filter({ hasText: "All-time" }).click();
    await expect(page).toHaveURL(/\/app\/stats\?range=all$/);
    await expect(page.getByText(/Progress · All-time/i)).toBeVisible();

    // Click 30 days → URL drops the param (canonical clean URL).
    await page.getByTestId("stats-range-option").filter({ hasText: "30 days" }).click();
    await expect(page).toHaveURL(/\/app\/stats$/);
  });

  test("no active block → renders the 'Start one' CTA", async ({
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

    const activeBlock = page.getByTestId("stats-card-active-block");
    await expect(activeBlock).toBeVisible();
    await expect(activeBlock).toContainText(/No active block/i);

    await page.getByTestId("stats-active-block-cta").click();
    await expect(page).toHaveURL(/\/app\/plan\/new$/);
  });
});
