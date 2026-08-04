import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Main-vs-accessory movement queue + active prescription summary.
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
test.describe("@desktop Focus Strip — movement summaries", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders main and accessory movements with active summaries", async ({
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
    const startCta = page.getByRole("link", { name: /start workout/i }).first();
    await expect(startCta).toBeVisible({ timeout: 15_000 });
    await startCta.click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
      timeout: 15_000,
    });

    const focusStrip = page.getByTestId("focus-strip-logger");
    await expect(focusStrip).toBeVisible();
    const squat = page.getByTestId(
      `focus-strip-queue-${seed.todayMovementId}`,
    );
    const carry = page.getByTestId(`focus-strip-queue-${farmer!.id}`);
    await expect(squat).toBeVisible();
    await expect(carry).toBeVisible();

    await squat.click();
    await expect(focusStrip.getByRole("heading", { level: 2 })).toContainText(
      /squat/i,
    );
    await expect(focusStrip).toContainText(/Main lift/i);
    await expect(focusStrip).toContainText(/1×5/);
    await expect(focusStrip).toContainText(/% TM/);

    await carry.click();
    await expect(focusStrip.getByRole("heading", { level: 2 })).toContainText(
      /farmer/i,
    );
    await expect(focusStrip).toContainText(/Accessory/i);
    await expect(focusStrip).toContainText(/1×10/);
  });
});
