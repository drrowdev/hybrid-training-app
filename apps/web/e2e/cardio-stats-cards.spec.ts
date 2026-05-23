import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Cardio stats cards — empty-state smoke tests.
 *
 * Verifies the no-data branches of the three Strava-gated cards
 * (RunPlanAdherenceCard / HrZonesCard / PacePRsCard) render their
 * EmptyState primitives instead of crashing or rendering confusing
 * zeros. A fresh user with no Strava connection and no training blocks
 * is the v1 baseline; the data branches are exercised by unit tests
 * over the pure compute helpers.
 */

test.describe("@desktop /app/stats/adherence cardio cards", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("renders the three cardio cards in their empty states", async ({
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

    // All three cards collapse to EmptyState (no Strava + no block).
    const empties = page.getByTestId("empty-state");
    // The page has other potential empty-states, so we assert at least 3.
    await expect.poll(async () => await empties.count()).toBeGreaterThanOrEqual(3);

    await expect(page.getByText(/No cardio plan yet|Cardio plan/i).first()).toBeVisible();
    await expect(page.getByText(/HR zones need Strava|HR-stream data/i).first()).toBeVisible();
    await expect(page.getByText(/Pace PRs need Strava|No runs yet/i).first()).toBeVisible();
  });

  test("/app/settings/hr-zones stub page renders without 404", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/settings/hr-zones");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "HR zones" })).toBeVisible();
    await expect(page.getByText(/coming soon/i)).toBeVisible();
  });
});
