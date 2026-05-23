import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * /app/races · self-serve priority event management.
 *
 * Coverage:
 *  - Empty state renders the EmptyState card with the explainer copy
 *    plus an "Add event" CTA.
 *  - Add modal opens, accepts name/date/priority/modality, saves.
 *  - The new row appears in the upcoming list and as a dot on the
 *    timeline strip.
 *  - Edit changes the name in place.
 *  - Delete removes the row.
 */
test.describe("@desktop /app/races · priority event management", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("empty → add → edit → delete flow", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    // Pick a target date roughly 3 months out (90 days). YYYY-MM-DD
    // calendar arithmetic via UTC to dodge DST drift in the spec.
    const now = new Date();
    const target = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 90),
    );
    const ymd = target.toISOString().slice(0, 10);

    await page.goto("/app/races");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("races-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /events/i }),
    ).toBeVisible();

    // Empty state.
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("empty-state-title")).toContainText(
      /no events yet/i,
    );

    // Open the Add modal and fill it.
    await page.getByTestId("add-event-button").click();
    await expect(page.getByTestId("event-form-modal")).toBeVisible();
    await page.getByTestId("ev-name").fill("Half marathon attempt");
    await page.getByTestId("ev-date").fill(ymd);
    await page.getByTestId("ev-priority").selectOption("B");
    await page.getByTestId("ev-modality").selectOption("run");
    await page.getByTestId("perf-distance").fill("21.0975");
    await page.getByTestId("perf-time").fill("1:35:00");
    await page.getByTestId("ev-save").click();
    await expect(page.getByTestId("event-form-modal")).toBeHidden();

    // Row visible in upcoming list.
    const row = page.getByTestId(/^event-row-/).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/half marathon attempt/i);
    await expect(row).toContainText(/B — important/i);
    await expect(row).toContainText(/Run/);

    // Timeline strip has a dot.
    await expect(page.getByTestId("timeline-strip")).toBeVisible();
    await expect(page.locator('[data-testid^="timeline-dot-"]')).toHaveCount(1);

    // Expand and edit — rename it.
    await row.getByTestId("event-row-toggle").click();
    await row.getByTestId("event-edit").click();
    const editModal = page.getByTestId("event-form-modal");
    await expect(editModal).toBeVisible();
    await editModal.getByTestId("ev-name").fill("Half marathon — autumn");
    await editModal.getByTestId("ev-save").click();
    await expect(editModal).toBeHidden();
    await expect(page.getByTestId(/^event-row-/).first()).toContainText(
      /half marathon — autumn/i,
    );

    // Delete via the confirm() dialog.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId(/^event-row-/).first().getByTestId("event-row-toggle").click();
    await page.getByTestId(/^event-row-/).first().getByTestId("event-delete").click();
    await expect(page.getByTestId(/^event-row-/)).toHaveCount(0);
    // Empty state reappears.
    await expect(page.getByTestId("empty-state")).toBeVisible();
  });
});
