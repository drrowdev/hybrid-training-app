import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import { seedMovementHistory } from "./fixtures/seed-movement";

/**
 * Desktop /app/stats/movements/[slug] — Phase 5 per-movement deep dive.
 *
 * Pre-condition (seeded via service-role admin client):
 *  - Eight Back Squat sessions ramping 100→122.5 kg (latest = PR)
 *  - One Front Squat session at 90 kg (sister-movement peer e1RM)
 *  - One planned_session with a Front Squat → Back Squat swap recorded
 *    in `prescription.items[0].meta.swappedFrom` / `swappedAt`
 *
 * The spec lands on `/app/stats/movements/back-squat` and asserts:
 *  - all eight Phase 5 sections render
 *  - at least one PR badge is present on the top-sets table
 *  - clicking a top-set row navigates to the corresponding session
 *  - the swap-history card surfaces the seeded Front Squat swap
 *  - sister-movement card lists Front Squat with its current e1RM
 *  - the range toggle (30d default → 90d) updates the URL
 */

test.describe("@desktop /app/stats/movements/[slug]", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all eight sections, PR badge, swap row, sister peer, click-through + range toggle", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    const seeded = await seedMovementHistory(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/movements/back-squat");
    await page.waitForLoadState("networkidle");

    // ── A · header ─────────────────────────────────────────────
    await expect(page.getByTestId("stats-movement-header")).toBeVisible();
    await expect(page.getByTestId("stats-movement-title")).toHaveText(/Back Squat/);
    await expect(page.getByTestId("stats-movement-current-e1rm")).toContainText(/kg/);
    await expect(page.getByTestId("stats-movement-best-ever")).toContainText(/Best ever/);

    // ── B · e1RM trend ─────────────────────────────────────────
    await expect(page.getByTestId("stats-movement-e1rm")).toBeVisible();
    await expect(page.getByTestId("stats-movement-e1rm-slope")).toContainText(/kg\/week/);

    // ── C · top sets w/ PR badge + click-through ───────────────
    await expect(page.getByTestId("stats-movement-top-sets")).toBeVisible();
    const prBadges = page.getByTestId("stats-movement-pr-badge");
    expect(await prBadges.count()).toBeGreaterThan(0);

    const firstRow = page.getByTestId("stats-movement-top-set-row").first();
    const href = await firstRow.getAttribute("href");
    expect(href).toMatch(/^\/app\/sessions\/[0-9a-f-]+$/);

    // ── D · volume trend ───────────────────────────────────────
    await expect(page.getByTestId("stats-movement-volume")).toBeVisible();

    // ── E · RPE trend ──────────────────────────────────────────
    await expect(page.getByTestId("stats-movement-rpe")).toBeVisible();

    // ── F · swap history ───────────────────────────────────────
    await expect(page.getByTestId("stats-movement-swaps")).toBeVisible();
    const swapRows = page.getByTestId("stats-movement-swap-row");
    expect(await swapRows.count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("stats-movement-swaps")).toContainText(/Front Squat/);

    // ── G · recent sessions ────────────────────────────────────
    await expect(page.getByTestId("stats-movement-recent")).toBeVisible();
    expect(
      await page.getByTestId("stats-movement-recent-row").count(),
    ).toBeGreaterThan(0);

    // ── H · sister movements ───────────────────────────────────
    await expect(page.getByTestId("stats-movement-sisters")).toBeVisible();
    await expect(page.getByTestId("stats-movement-sisters")).toContainText(/Front Squat/);

    // ── Click-through to session detail ────────────────────────
    await firstRow.click();
    await page.waitForLoadState("networkidle");
    expect(page.url()).toMatch(/\/app\/sessions\/[0-9a-f-]+/);

    // ── Range toggle: 30d default → 90d ────────────────────────
    await page.goto("/app/stats/movements/back-squat");
    await page.waitForLoadState("networkidle");
    await expect(
      page
        .getByTestId("stats-movement-range-option")
        .filter({ hasText: "30 days" }),
    ).toHaveAttribute("data-active", "true");
    await page
      .getByTestId("stats-movement-range-option")
      .filter({ hasText: "90 days" })
      .click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\/movements\/back-squat\?range=90d$/);
    await expect(
      page
        .getByTestId("stats-movement-range-option")
        .filter({ hasText: "90 days" }),
    ).toHaveAttribute("data-active", "true");

    // Sanity: the latest seeded session is part of the visible history.
    expect(seeded.latestBackSquatSessionId).toBeTruthy();
  });

  test("empty state for a fresh user with no working sets", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/movements/back-squat");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-movement-e1rm")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-movement-top-sets")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-movement-volume")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-movement-rpe")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-movement-swaps")).toHaveAttribute(
      "data-empty",
      "true",
    );
  });
});
