import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * AMRAP→e1RM vs entered 1RM provenance distinction.
 *
 * Verifies the Settings → Training-maxes page surfaces the source of every
 * TM via a `tm-source-badge` element. The default `entered` rows render a
 * muted "(entered)" label; rows flipped to `derived_amrap` via direct
 * admin write render an accent-colored "(e1RM · …)" label.
 *
 * The full Today-page banner flow (AMRAP completion → suggestion → Accept)
 * lives in the unit tests for the gate logic (`suggestions.test.ts`) — the
 * banner DOM contract is already covered by the badge data attribute here.
 */

test.describe("@desktop /app/settings/training-maxes · e1RM provenance", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("entered vs derived_amrap renders distinct badges", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Pick a real seeded movement (any compound row) and seed an entered TM.
    const { data: movement } = await admin
      .from("movements")
      .select("id, display_name, slug")
      .eq("slug", "back_squat")
      .is("user_id", null)
      .maybeSingle();
    expect(movement, "back_squat movement must exist in catalog").toBeTruthy();

    const { error: insertErr } = await admin.from("training_maxes").upsert(
      {
        user_id: freshUser.userId,
        movement_id: movement!.id,
        one_rm_kg: 140,
        source: "entered",
      },
      { onConflict: "user_id,movement_id" },
    );
    expect(insertErr).toBeNull();

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.goto("/app/settings/training-maxes");
    await page.waitForLoadState("networkidle");

    // At least one badge must render with source=entered.
    const enteredBadge = page
      .locator('[data-testid="tm-source-badge"][data-source="entered"]')
      .first();
    await expect(enteredBadge).toBeVisible();
    await expect(enteredBadge).toContainText("(entered)");

    // Flip the row to derived_amrap (Epley) via direct admin write — this
    // simulates the post-AMRAP suggestion-accept path without needing the
    // full session-completion flow.
    const { error: updateErr } = await admin
      .from("training_maxes")
      .update({
        source: "derived_amrap",
        derived_formula: "epley",
        derived_at: new Date().toISOString(),
      })
      .eq("user_id", freshUser.userId)
      .eq("movement_id", movement!.id);
    expect(updateErr).toBeNull();

    await page.reload();
    await page.waitForLoadState("networkidle");

    const derivedBadge = page
      .locator('[data-testid="tm-source-badge"][data-source="derived_amrap"]')
      .first();
    await expect(derivedBadge).toBeVisible();
    await expect(derivedBadge).toContainText("e1RM");
    await expect(derivedBadge).toContainText("Epley");

    // The "Where did this come from?" expander should now be present for
    // this row (only renders for non-entered sources).
    await expect(
      page.locator('[data-testid="tm-source-detail"]').first(),
    ).toBeVisible();
  });
});
