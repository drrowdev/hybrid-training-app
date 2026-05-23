import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";
import {
  seedSessionWellness,
  seedWellnessHistory,
} from "./fixtures/seed-wellness";

/**
 * Desktop /app/stats/wellness — Phase 3 wellness dashboard.
 *
 * Pre-condition (seeded directly via service-role admin client):
 *  - 30 days of `wellness` rows (bodyweight + motivation)
 *  - 14 sessions carrying fatigue / soreness / session_rpe so the
 *    prediction-accuracy scatter has >= 10 pairs.
 *
 * The spec:
 *  - asserts the bodyweight / fatigue / soreness / motivation cards +
 *    the prediction-accuracy card render. (The sleep section was
 *    removed in fix/sleep-walkback — manual sleep entry is deferred
 *    to the future health-app integration.)
 *  - exercises the range toggle (30d -> 90d) and asserts the URL +
 *    re-render.
 *  - sanity-checks the empty-state path for a brand-new user.
 */

test.describe("@desktop /app/stats/wellness", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all sections with seeded data + range toggle works", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await seedWellnessHistory(admin, freshUser.userId, 30);
    await seedSessionWellness(admin, freshUser.userId, 14);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/wellness");
    await page.waitForLoadState("networkidle");

    // ─── All sections render (sleep section intentionally absent) ──
    await expect(page.getByTestId("stats-wellness-bodyweight")).toBeVisible();
    await expect(page.getByTestId("stats-wellness-sleep")).toHaveCount(0);
    await expect(page.getByTestId("stats-wellness-fatigue")).toBeVisible();
    await expect(page.getByTestId("stats-wellness-soreness")).toBeVisible();
    await expect(page.getByTestId("stats-wellness-motivation")).toBeVisible();
    await expect(page.getByTestId("stats-wellness-prediction")).toBeVisible();

    // Bodyweight card has a delta string.
    await expect(page.getByTestId("stats-wellness-bodyweight-delta")).toContainText(
      /\(30d\)/i,
    );

    // Prediction card with seeded data renders the numeric correlation
    // and a strength label, not the empty-state copy.
    await expect(
      page.getByTestId("stats-wellness-prediction-correlation"),
    ).toContainText(/Prediction accuracy:/i);
    await expect(
      page.getByTestId("stats-wellness-prediction-strength"),
    ).toContainText(/n=\d+/);
    await expect(page.getByTestId("stats-wellness-prediction")).toHaveAttribute(
      "data-empty",
      "false",
    );

    // ─── Range toggle: 30d → 90d ──────────────────────────────────
    const toggle = page.getByTestId("stats-wellness-range-toggle");
    await expect(toggle).toBeVisible();
    await expect(
      page
        .getByTestId("stats-wellness-range-option")
        .filter({ hasText: "30 days" }),
    ).toHaveAttribute("data-active", "true");

    await page
      .getByTestId("stats-wellness-range-option")
      .filter({ hasText: "90 days" })
      .click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\/wellness\?range=90d$/);
    await expect(
      page
        .getByTestId("stats-wellness-range-option")
        .filter({ hasText: "90 days" }),
    ).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("stats-wellness-bodyweight")).toContainText(
      /last 90 days/i,
    );

    // Back to default 30d (param drops).
    await page
      .getByTestId("stats-wellness-range-option")
      .filter({ hasText: "30 days" })
      .click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/app\/stats\/wellness$/);

    // ─── Footer links ──────────────────────────────────────────────
    await expect(page.getByTestId("stats-wellness-overview-link")).toBeVisible();
    await expect(page.getByTestId("stats-wellness-engine-link")).toBeVisible();
    await page.getByTestId("stats-wellness-engine-link").click();
    await expect(page).toHaveURL(/\/app\/stats\/engine$/);
  });

  test("brand-new user sees empty-state copy on every section", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/stats/wellness");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("stats-wellness-bodyweight")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-wellness-bodyweight")).toContainText(
      /Log bodyweight on the Today page/i,
    );

    // Sleep section was removed in fix/sleep-walkback — must not render.
    await expect(page.getByTestId("stats-wellness-sleep")).toHaveCount(0);

    await expect(page.getByTestId("stats-wellness-fatigue")).toContainText(
      /Pre-session check-in not used yet/i,
    );
    await expect(page.getByTestId("stats-wellness-soreness")).toContainText(
      /Pre-session check-in not used yet/i,
    );
    await expect(page.getByTestId("stats-wellness-motivation")).toContainText(
      /Track motivation on daily check-ins/i,
    );

    await expect(page.getByTestId("stats-wellness-prediction")).toHaveAttribute(
      "data-empty",
      "true",
    );
    await expect(page.getByTestId("stats-wellness-prediction")).toContainText(
      /Need at least 10 sessions/i,
    );
  });
});
