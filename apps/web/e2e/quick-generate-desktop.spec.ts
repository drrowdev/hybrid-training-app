import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import {
  markOnboarded,
  seedStrengthTms,
  seedRecentBlock,
} from "./fixtures/seed-blocks";

/**
 * Quick-generate strength workout - desktop UX regression (ADR 0029).
 *
 * Guards the two quirks fixed after the first ship:
 *   1. The generated session renders the SAME grouped "MAIN LIFTS /
 *      ACCESSORY WORK" layout as a planned strength workout (driven by an
 *      off-plan prescription stored on the session, not flat freestyle cards).
 *   2. It starts at zero logged sets - NOT "N of N sets logged" - because the
 *      prescription is no longer materialised as pre-filled set_logs.
 * And confirms interactive logging works end-to-end on the off-plan session.
 */
test.describe("@desktop quick-generate strength", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("generates a planned-style session that starts unlogged and logs a set", async ({
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
    await seedRecentBlock(admin, freshUser.userId, {
      archetype: "strength_anchor",
      status: "active",
      daysPerWeek: 4,
    });
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Generate a Normal quick strength session.
    await page.getByTestId("quick-workout-card").click();
    await page.getByTestId("quick-tile-generate-normal").click();
    await page.waitForURL(/\/app\/sessions\/.+/, { timeout: 30000 });
    await page
      .getByRole("heading", { name: /Quick workout/i })
      .first()
      .waitFor({ state: "visible", timeout: 30000 });
    await page
      .getByTestId("movement-card-list")
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    // Quirk 1: planned-style grouped layout (not the flat freestyle list).
    await expect(page.getByText("MAIN LIFTS", { exact: false })).toBeVisible();
    await expect(
      page.getByText("ACCESSORY WORK", { exact: false }),
    ).toBeVisible();
    // The main lift carries a TM badge + a %TM prescription line.
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/TM\s*\d+/); // "TM 90 kg"
    expect(body).toMatch(/% TM/); // "5..5..5 @ 65/75/85% TM"

    // Quirk 2: the session starts UNLOGGED - no "N of N sets logged", and the
    // finish CTA is gated on logging at least one set.
    expect(body).not.toMatch(/\b([1-9]\d*) of \1 sets logged\b/);
    await expect(
      page.getByText(/log at least 1 set to finish/i).first(),
    ).toBeVisible();

    // Interactive logging works on the off-plan prescription session: logging a
    // set flips the finish CTA from the gated "log at least 1 set" state to an
    // enabled "Finish session".
    await page.getByText("Back Squat", { exact: false }).first().click();
    await page
      .getByRole("button", { name: /^log set/i })
      .first()
      .click();
    await expect(
      page.getByRole("link", { name: /finish session/i }).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});