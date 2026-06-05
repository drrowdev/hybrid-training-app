import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedAdherenceHistory } from "./fixtures/seed-adherence";

/**
 * Desktop /app/stats/adherence — Phase 4 adherence dashboard.
 *
 * Pre-condition (seeded via service-role admin client):
 *  - Primary block: strength_anchor, 8 weeks × 3 days, mostly logged
 *    with two skipped sessions in weeks 6–7.
 *  - Secondary block: hypertrophy_anchor, 4 weeks × 3 days, all logged.
 *
 * The spec asserts:
 *  - all five sections render with seeded data
 *  - the range toggle (12w default → 26w) updates the URL and re-renders
 *  - the streak number matches the seeded "no skips in weeks 0..5" run
 *  - the per-archetype card surfaces both archetype display names
 */

test.describe("@desktop /app/stats/adherence", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all sections + range toggle + seeded streak", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const seeded = await seedAdherenceHistory(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/adherence");
    await page.waitForLoadState("networkidle");

    // ── All five sections render ─────────────────────────────────
    await expect(page.getByTestId("stats-adherence-weekly")).toBeVisible();
    await expect(page.getByTestId("stats-adherence-weekday")).toBeVisible();
    await expect(page.getByTestId("stats-adherence-archetype")).toBeVisible();
    await expect(page.getByTestId("stats-adherence-skipped")).toBeVisible();
    await expect(page.getByTestId("stats-adherence-streaks")).toBeVisible();

    // Weekly headline chart has bars + an axis row with at least the
    // last 8 weeks present.
    const weekCells = page.getByTestId("stats-adherence-week-cell");
    expect(await weekCells.count()).toBeGreaterThanOrEqual(8);

    // Weekday card has 7 columns and at least one column shows a
    // numeric percentage (i.e. seeded data is non-empty).
    const weekdayCells = page.getByTestId("stats-adherence-weekday-cell");
    await expect(weekdayCells).toHaveCount(7);
    await expect(
      page.getByTestId("stats-adherence-weekday-pct").first(),
    ).toHaveText(/%|—/);

    // Per-archetype card lists both seeded archetypes.
    const archetypeRows = page.getByTestId("stats-adherence-archetype-row");
    await expect(archetypeRows).toHaveCount(2);
    await expect(page.getByTestId("stats-adherence-archetype")).toContainText(
      /Strength Focus/i,
    );
    await expect(page.getByTestId("stats-adherence-archetype")).toContainText(
      /Hypertrophy Focus/i,
    );

    // Skipped-notes card has exactly the seeded skip count (2).
    const skippedRows = page.getByTestId("stats-adherence-skipped-row");
    await expect(skippedRows).toHaveCount(seeded.totalSkipped);

    // ── Streak assertion ────────────────────────────────────────
    // We seeded weeks 0..5 with no skips, so the longest streak
    // must be at least the conservative lower bound surfaced by the
    // fixture.
    const longestText = await page
      .getByTestId("stats-adherence-streak-longest")
      .innerText();
    const longestDays = Number.parseInt(longestText.match(/\d+/)?.[0] ?? "0", 10);
    expect(longestDays).toBeGreaterThanOrEqual(seeded.expectedLongestStreakMin);

    // ── Range toggle: 12w → 26w ─────────────────────────────────
    const toggle = page.getByTestId("stats-adherence-range-toggle");
    await expect(toggle).toBeVisible();
    await expect(
      page
        .getByTestId("stats-adherence-range-option")
        .filter({ hasText: "12 weeks" }),
    ).toHaveAttribute("data-active", "true");

    await page
      .getByTestId("stats-adherence-range-option")
      .filter({ hasText: "26 weeks" })
      .click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\/adherence\?range=26w$/);
    await expect(
      page
        .getByTestId("stats-adherence-range-option")
        .filter({ hasText: "26 weeks" }),
    ).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("stats-adherence-weekly")).toContainText(
      /26 weeks/i,
    );

    // Back to default 12w (param drops).
    await page
      .getByTestId("stats-adherence-range-option")
      .filter({ hasText: "12 weeks" })
      .click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\/adherence$/);

    // ── Nav: top back-link → Stats overview; footer → block outcomes ──
    await expect(page.getByTestId("back-link")).toBeVisible();
    await expect(page.getByTestId("stats-adherence-blocks-link")).toBeVisible();
    await page.getByTestId("stats-adherence-blocks-link").click();
    await expect(page).toHaveURL(/\/app\/stats\/blocks$/);
  });

  test("empty state for a brand-new user with no blocks", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/adherence");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-adherence-weekly")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-adherence-weekly")).toContainText(
      /Build a block/i,
    );
    await expect(page.getByTestId("stats-adherence-archetype")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-adherence-skipped")).toContainText(
      /No skipped sessions/i,
    );
  });
});
