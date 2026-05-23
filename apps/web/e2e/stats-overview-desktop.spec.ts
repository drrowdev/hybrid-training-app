import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedPlannedSessionsForBlock,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * Desktop /app/stats — Phase 1 overview dashboard.
 *
 * Pre-condition (seeded directly via service-role admin client):
 *  - one active block + 5 completed planned sessions + 2 skipped
 *  - one bodyweight wellness entry
 *
 * The spec then signs the user in, lands on /app/stats, asserts every
 * card renders with non-empty data, and clicks each "View / deep dive"
 * link to confirm the routing surface is intact.
 */

test.describe("@desktop /app/stats overview", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders every card with seeded data + bottom deep-dive links route correctly", async ({
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
    // Mark 2 of the unfilled planned rows as skipped so the adherence
    // card's "skipped → missed" wiring is exercised.
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

    // ─── A: Current block strip ────────────────────────────────────
    const activeBlock = page.getByTestId("stats-card-active-block");
    await expect(activeBlock).toBeVisible();
    await expect(activeBlock).toContainText(/Strength Focus/i);
    await expect(activeBlock).toContainText(/Week 2 of 4/i);
    await expect(activeBlock).toContainText(/Day .* of 4 days\/week/i);
    await expect(page.getByTestId("stats-active-block-completion")).toContainText(
      /5 of \d+ sessions logged/i,
    );

    // ─── B: Adherence ──────────────────────────────────────────────
    const adherence = page.getByTestId("stats-card-adherence");
    await expect(adherence).toBeVisible();
    // 5 logged out of 7 scheduled-to-date (skipped count toward the
    // denominator) → 71%. Use a regex bracket so a slightly different
    // seed run still passes.
    await expect(adherence).toContainText(/%/);
    await expect(adherence).toContainText(/skipped/i);

    // ─── C: PRs window — empty state in this fixture ──────────────
    // No actual set_logs were inserted, so the PR walk finds nothing.
    const prs = page.getByTestId("stats-card-prs");
    await expect(prs).toBeVisible();
    await expect(prs).toContainText(/PRs/i);

    // ─── D: Region freshness — no logged sessions → empty state ───
    const freshness = page.getByTestId("stats-card-freshness");
    await expect(freshness).toBeVisible();

    // ─── F: Volume — no set_logs → empty state but card renders ───
    const volume = page.getByTestId("stats-card-volume");
    await expect(volume).toBeVisible();

    // ─── G: Bodyweight card ────────────────────────────────────────
    const bodyweight = page.getByTestId("stats-card-bodyweight");
    await expect(bodyweight).toBeVisible();
    await expect(bodyweight).toContainText(/82\.5/);

    // ─── Bottom deep-dive grid + routing ───────────────────────────
    const deepDives = page.getByTestId("stats-deep-dive");
    await expect(deepDives).toHaveCount(4);

    // Per-movement → anchor on the same page.
    await deepDives.nth(0).click();
    await expect(page).toHaveURL(/\/app\/stats(#movements)?$/);

    // Engine internals.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(1).click();
    await expect(page).toHaveURL(/\/app\/stats\/engine$/);

    // Block outcomes → /app/stats/blocks.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(2).click();
    await expect(page).toHaveURL(/\/app\/stats\/blocks$/);

    // Wellness dashboard → /app/stats/wellness (Phase 3).
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-deep-dive").nth(3).click();
    await expect(page).toHaveURL(/\/app\/stats\/wellness$/);

    // Current-block CTA → /app/plan/history.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-active-block-cta").click();
    await expect(page).toHaveURL(/\/app\/plan\/history$/);

    // Freshness CTA → /app/stats/engine.
    await page.goto("/app/stats");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("stats-freshness-cta").click();
    await expect(page).toHaveURL(/\/app\/stats\/engine$/);
  });

  test("range toggle: clicking 90d / all / 30d updates the URL and re-renders cards", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Seed a minimal block so the page has something to render.
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

    // Click 90 days → URL gains ?range=90d.
    await page.getByTestId("stats-range-option").filter({ hasText: "90 days" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\?range=90d$/);
    await expect(page.getByTestId("stats-card-adherence")).toContainText(/last 90 days/i);
    await expect(page.getByTestId("stats-card-prs")).toContainText(/last 90 days/i);

    // Click All-time → URL gains ?range=all.
    await page.getByTestId("stats-range-option").filter({ hasText: "All-time" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\?range=all$/);
    await expect(page.getByTestId("stats-card-adherence")).toContainText(/all-time/i);

    // Click 30 days → URL drops the param (canonical clean URL).
    await page.getByTestId("stats-range-option").filter({ hasText: "30 days" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats$/);
  });

  test("no active block → renders the 'Start one →' CTA", async ({
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
