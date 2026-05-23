import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * Desktop /app/stats/blocks — Phase 2 block outcomes deep dive.
 *
 * Pre-condition (seeded via the service-role admin client):
 *  - two blocks with different archetypes
 *    1. completed `strength_anchor`, 4 weeks, 4 of 8 planned logged
 *    2. active   `hypertrophy_anchor`, 4 weeks, 2 of 4 planned logged
 *
 * The spec:
 *  - lists /app/stats/blocks and asserts both cards render with the
 *    archetype display names + the KPI tiles (delta / PRs / sleep).
 *  - clicks into the first card and asserts every B1–B6 section
 *    renders (with the empty-state copy where data is absent).
 *  - opens the comparison picker and selects the other block,
 *    asserting the side-by-side comparison view renders.
 */

test.describe("@desktop /app/stats/blocks deep dive", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("lists blocks, opens a deep dive, and compares two blocks", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Block 1 — completed strength_anchor, started 60 days ago.
    const block1Start = new Date(Date.now() - 60 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const block1Id = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      daysPerWeek: 4,
      weeks: 4,
      status: "completed",
      startedOn: block1Start,
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, block1Id, {
      totalSessions: 8,
      loggedCount: 4,
    });
    // Mark the block as ended so the date range renders an end date.
    {
      const { error } = await admin
        .from("training_blocks")
        .update({
          ended_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          completed_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        })
        .eq("id", block1Id);
      if (error) throw new Error(`update ended_at: ${error.message}`);
    }

    // Block 2 — active hypertrophy_anchor, started 14 days ago.
    const block2Start = new Date(Date.now() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const block2Id = await seedRecentBlock(admin, freshUser.userId, {
      archetype: "hypertrophy_anchor",
      daysPerWeek: 4,
      weeks: 4,
      status: "active",
      startedOn: block2Start,
    });
    await seedPlannedSessionsForBlock(admin, freshUser.userId, block2Id, {
      totalSessions: 4,
      loggedCount: 2,
    });

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    // ── Index page ────────────────────────────────────────────────
    await page.goto("/app/stats/blocks");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-blocks-list")).toBeVisible();
    const cards = page.getByTestId("stats-block-card");
    await expect(cards).toHaveCount(2);
    // Most recent first — block 2 (active hypertrophy) sits on top.
    await expect(cards.nth(0)).toContainText(/Hypertrophy Focus/i);
    await expect(cards.nth(1)).toContainText(/Strength Focus/i);
    // Each card surfaces the three KPI tiles.
    await expect(cards.nth(0).getByTestId("stats-block-card-delta")).toBeVisible();
    await expect(cards.nth(0).getByTestId("stats-block-card-prs")).toBeVisible();
    await expect(cards.nth(0).getByTestId("stats-block-card-sleep")).toBeVisible();

    // ── Deep dive ─────────────────────────────────────────────────
    // Click the strength block (bottom card) so the deep dive opens
    // on a completed block, which exercises the "Ended" badge path.
    await cards.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/app/stats/blocks/${block1Id}$`));
    await page.waitForLoadState("networkidle");

    // B1 header.
    await expect(page.getByTestId("stats-block-header")).toBeVisible();
    await expect(page.getByTestId("stats-block-header")).toContainText(/Strength Focus/i);

    // B2 main lifts — fixture doesn't seed set_logs, so the empty-state
    // copy renders.
    await expect(page.getByTestId("stats-block-mainlifts-empty")).toBeVisible();

    // B3 adherence.
    await expect(page.getByTestId("stats-block-adherence")).toBeVisible();
    await expect(page.getByTestId("stats-block-adherence-summary")).toContainText(
      /\d+ of \d+ sessions logged/i,
    );
    await expect(page.getByTestId("stats-block-adherence-weekday")).toBeVisible();
    await expect(page.getByTestId("stats-block-adherence-weekday-cell")).toHaveCount(7);

    // B4 RPE creep — empty (no RPE logged).
    await expect(page.getByTestId("stats-block-rpe-creep-empty")).toBeVisible();

    // B5 power outcome — block has power_emphasis=false → section absent.
    await expect(page.getByTestId("stats-block-power-outcome")).toHaveCount(0);

    // B6 wellness — section renders even with no signal (empty tiles).
    await expect(page.getByTestId("stats-block-wellness")).toBeVisible();
    await expect(page.getByTestId("stats-block-wellness-sleep")).toBeVisible();

    // ── Compare picker → comparison view ─────────────────────────
    const picker = page.getByTestId("stats-block-compare-picker");
    await expect(picker).toBeVisible();
    const compareOption = page
      .getByTestId("stats-block-compare-option")
      .filter({ hasText: /Hypertrophy Focus/i });
    await compareOption.click();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(
      new RegExp(`/app/stats/blocks/${block1Id}\\?compare=${block2Id}$`),
    );
    await expect(page.getByTestId("stats-block-compare-banner")).toBeVisible();
    await expect(page.getByTestId("stats-block-compare-banner")).toContainText(
      /different archetypes/i,
    );
    await expect(page.getByTestId("stats-block-compare-adherence")).toBeVisible();
    await expect(page.getByTestId("stats-block-compare-prs")).toBeVisible();
    await expect(page.getByTestId("stats-block-compare-sleep")).toBeVisible();

    // Clear comparison → back to the deep dive on block 1 alone.
    await page.getByTestId("stats-block-compare-clear").click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(new RegExp(`/app/stats/blocks/${block1Id}$`));
    await expect(page.getByTestId("stats-block-compare-banner")).toHaveCount(0);
  });

  test("empty state when the user has no blocks", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/blocks");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("stats-blocks-empty")).toBeVisible();
  });
});
