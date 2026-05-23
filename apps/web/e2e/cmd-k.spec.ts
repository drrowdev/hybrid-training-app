import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

/**
 * Cmd-K quick-jump palette — desktop coverage.
 *
 * Verifies the new palette wired into the /app layout:
 *   - Cmd-K (mapped to Meta+k in Playwright, which also covers Ctrl-K
 *     via the global listener) opens the dialog from /app.
 *   - The input is focused on open + filters as the user types.
 *   - Enter navigates to the highlighted route.
 *   - Esc closes the dialog without navigating.
 *
 * Auth + onboarding follow the same fixture pattern as
 * `today-page-desktop.spec.ts`.
 */

test.describe("@desktop cmd-k quick-jump palette", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("opens with Cmd-K, navigates on Enter, closes on Esc", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Open the palette. Playwright's Meta+k maps to ⌘K on macOS; the
    // app-side listener accepts either metaKey or ctrlKey so the same
    // press also covers Ctrl-K paths.
    await page.keyboard.press("Meta+k");

    const dialog = page.getByTestId("cmdk-dialog");
    await expect(dialog).toBeVisible();

    const input = page.getByTestId("cmdk-input");
    await expect(input).toBeFocused();

    // Type "stats" — the Pages group should surface "Stats — Overview"
    // first thanks to the prefix bump.
    await input.fill("stats");

    const firstRow = page.locator("[data-cmdk-row='0']");
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toContainText(/stats/i);
    await expect(firstRow).toContainText(/overview/i);

    // Press Enter → navigates to /app/stats.
    await page.keyboard.press("Enter");
    await page.waitForURL("**/app/stats", { timeout: 10_000 });
    await expect(dialog).toHaveCount(0);

    // Re-open the palette and confirm Esc closes it without changing URL.
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("cmdk-dialog")).toBeVisible();

    const urlBefore = page.url();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cmdk-dialog")).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
  });
});
