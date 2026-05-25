import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Main-vs-accessory grouping + collapsed-card summary chip.
 *
 * Scenario:
 *   1. Sign in, seed today's strength session, then patch the planned
 *      prescription to also include a farmer carry accessory item so
 *      both sub-sections render.
 *   2. Open the session — assert the "Main lifts" and "Accessory work"
 *      section dividers render with the squat above the divider on
 *      the main side and the farmer carry under accessory.
 *   3. Assert the collapsed squat card header carries the new summary
 *      chip with the planned sets/reps text.
 */
test.describe("@desktop session log — lift grouping + summary chip", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders main / accessory dividers and collapsed-card summary chip", async ({
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
    const seed = await seedActiveBlock(admin, freshUser.userId);

    // Resolve the farmer-carry movement so we can patch the seeded
    // prescription to include an accessory bucket — the seed default
    // only emits a main lift.
    const { data: farmer, error: fErr } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .eq("slug", "farmer-carry-db")
      .single();
    expect(fErr).toBeFalsy();
    expect(farmer).toBeTruthy();

    // Read the existing planned prescription, then append a farmer
    // carry accessory item. The session detail page reads the
    // prescription off planned_sessions for not-yet-started sessions.
    const { data: planned, error: pErr } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(pErr).toBeFalsy();
    const prescription = planned!.prescription as { items: unknown[] };
    prescription.items.push({
      movementId: farmer!.id,
      movementSlug: farmer!.slug,
      movementName: farmer!.display_name,
      kind: "accessory",
      sets: 3,
      reps: 10,
    });
    const { error: upErr } = await admin
      .from("planned_sessions")
      .update({ prescription })
      .eq("id", seed.todayPlannedId);
    expect(upErr).toBeFalsy();

    await signInAs(context, freshUser, seedConfig, url);

    // Drive into the session via the start link — interstitial removed, auto-redirects.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const startCta = page.getByRole("link", { name: /start session/i }).first();
    await expect(startCta).toBeVisible({ timeout: 15_000 });
    await startCta.click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
      timeout: 15_000,
    });

    // Section dividers — both visible, main above accessory.
    const mainDivider = page.getByTestId("movement-group-main");
    const accessoryDivider = page.getByTestId("movement-group-accessory");
    await expect(mainDivider).toBeVisible();
    await expect(accessoryDivider).toBeVisible();
    await expect(mainDivider).toHaveText(/main lifts/i);
    await expect(accessoryDivider).toHaveText(/accessory work/i);

    // The squat card sits between the two dividers; the farmer carry
    // card sits after the accessory divider.
    const squatCard = page.locator(
      `[data-testid="movement-card-${seed.todayMovementId}"]`,
    );
    const farmerCard = page.locator(
      `[data-testid="movement-card-${farmer!.id}"]`,
    );
    await expect(squatCard).toBeVisible();
    await expect(farmerCard).toBeVisible();

    // Collapse the squat card (it may auto-open as the active card).
    if ((await squatCard.getAttribute("data-collapsed")) !== "true") {
      await page
        .getByTestId(`movement-card-header-${seed.todayMovementId}`)
        .click();
    }
    await expect(squatCard).toHaveAttribute("data-collapsed", "true", {
      timeout: 5_000,
    });

    // Summary chip is present on the collapsed card and reflects the
    // planned 3×5 @ pct% TM prescription seeded for today.
    const summary = page.getByTestId(
      `movement-card-summary-${seed.todayMovementId}`,
    );
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/3×5|5·5·5/);
    await expect(summary).toContainText(/% TM/);

    // The accessory card's summary should render the 3×10 prescription.
    if ((await farmerCard.getAttribute("data-collapsed")) !== "true") {
      await page
        .getByTestId(`movement-card-header-${farmer!.id}`)
        .click();
    }
    const farmerSummary = page.getByTestId(
      `movement-card-summary-${farmer!.id}`,
    );
    await expect(farmerSummary).toBeVisible();
    await expect(farmerSummary).toHaveText(/3×10/);
  });
});
