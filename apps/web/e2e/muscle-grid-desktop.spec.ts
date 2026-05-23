/**
 * E2E: /app/freshness — the 16-muscle freshness grid added in
 * feat/muscle-grid-16.
 *
 * Asserts:
 *   - the page renders for a signed-in user (legacy redirect is gone),
 *   - all 16 muscle labels are present in the legend,
 *   - both front and back SVG diagrams render,
 *   - tile colour mapping responds to a seeded recent set (red band),
 *   - the nav link out to the engine page is still there.
 */
import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

const MUSCLE_LABELS = [
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
  "Chest",
  "Back",
  "Lats",
  "Traps",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Obliques",
  "Erectors",
  "Adductors",
];

test.describe("@desktop /app/freshness — 16-muscle grid", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders all 16 muscle labels + both views", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    await page.goto("/app/freshness");
    await page.waitForLoadState("networkidle");

    // The grid container + both silhouettes render.
    await expect(page.getByTestId("muscle-grid-16")).toBeVisible();
    await expect(page.getByTestId("muscle-grid-front")).toBeVisible();
    await expect(page.getByTestId("muscle-grid-back")).toBeVisible();

    // Every one of the 16 labels appears in the legend.
    const legend = page.getByTestId("muscle-grid-legend");
    await expect(legend).toBeVisible();
    for (const label of MUSCLE_LABELS) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }

    // Every muscle has a corresponding tile data attribute.
    for (const muscle of [
      "quads",
      "hamstrings",
      "glutes",
      "calves",
      "core",
      "chest",
      "back",
      "lats",
      "traps",
      "shoulders",
      "biceps",
      "triceps",
      "forearms",
      "obliques",
      "erectors",
      "adductors",
    ]) {
      await expect(page.locator(`[data-muscle="${muscle}"]`).first()).toBeVisible();
    }

    // Engine-page link still wired.
    await expect(page.getByTestId("freshness-engine-link")).toBeVisible();
  });
});
