import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/recovery/injuries · self-serve limitations management.
 *
 * Coverage:
 *  - Empty state renders the EmptyState card with the explainer copy
 *    plus an "Add a limitation" primary CTA.
 *  - Add modal opens, accepts kind / severity / muscle picks, saves.
 *  - The new row appears as an ActiveLimitationCard with the chosen
 *    severity badge and kind.
 *  - Inline Resolve flips the row out of Active and into History.
 *  - History accordion expands and lists the resolved row.
 */
test.describe("@desktop /app/recovery/injuries · self-serve limitations", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("empty → add → active → resolve → history flow", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    await page.goto("/app/recovery/injuries");
    await page.waitForLoadState("networkidle");

    // Page mounted.
    await expect(page.getByTestId("injuries-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /limitations/i }),
    ).toBeVisible();

    // Empty state copy + CTA.
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("empty-state-title")).toContainText(
      /no limitations recorded/i,
    );
    const addButton = page.getByTestId("add-limitation-button").first();
    await expect(addButton).toBeVisible();

    // Open the Add modal and fill it.
    await addButton.click();
    await expect(page.getByTestId("add-limitation-modal")).toBeVisible();
    await page.getByTestId("lim-kind").fill("left knee");

    // Severity defaults to mild; bump to moderate.
    await page.getByTestId("lim-severity-moderate").click();

    // Pick the quads muscle via the chip list (deterministic — the SVG
    // tiles also work but the chip list is easier to target).
    await page.getByTestId("muscle-pick-chip-quads").click();

    // Save and wait for the modal to close.
    await page.getByTestId("lim-save").click();
    await expect(page.getByTestId("add-limitation-modal")).toBeHidden();

    // Active card visible with the right severity badge + kind.
    const card = page.getByTestId("active-limitation-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/moderate/i);
    await expect(card).toContainText(/left knee/i);

    // Expand and resolve.
    await card.getByTestId("active-card-toggle").click();
    await card.getByTestId("active-card-resolve").click();
    await expect(page.getByTestId("active-limitation-card")).toHaveCount(0);

    // History accordion now has it.
    const historyToggle = page.getByTestId("history-toggle");
    await expect(historyToggle).toBeVisible();
    await historyToggle.click();
    const historyRows = page.getByTestId("history-row");
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows.first()).toContainText(/left knee/i);
    await expect(historyRows.first()).toContainText(/moderate/i);
  });
});
