import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Accessory RIR / cue render on the focus view.
 *
 * The accessory-intensity matrix attaches RIR / tempo / cue fields to
 * accessory + tendon items at plan generation time. This spec verifies
 * the focus view surfaces them as a chip + plain-language cue so the
 * lifter can pick a weight without needing a %TM.
 *
 * Scenario:
 *   1. Seed today's strength session, then patch the planned
 *      prescription to add an isolation-style accessory item whose
 *      RIR / cue matches the hypertrophy / week-2 row of the matrix
 *      (`RIR 1–2`, "Clean reps. Leave 1–2 in the tank.").
 *   2. Start the session and select the accessory.
 *   3. Assert the RIR chip + cue text are visible. Cue is research-
 *      grounded plain English — no methodology / external program names.
 */
test.describe("@desktop Focus Strip — accessory RIR cue", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders RIR chip + cue text on an accessory card", async ({
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

    // Resolve a known movement from the seed catalog. The intensity
    // fields below are explicit so this rendering test stays deterministic.
    const { data: accessoryMovement, error: lErr } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .eq("slug", "farmer-carry-db")
      .maybeSingle();
    expect(lErr).toBeFalsy();
    expect(accessoryMovement).toBeTruthy();

    // Patch the planned prescription with an accessory item carrying
    // the hypertrophy / week-2 matrix output explicitly. Doing it here
    // rather than relying on the picker keeps the spec deterministic.
    const { data: planned, error: pErr } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(pErr).toBeFalsy();
    const prescription = planned!.prescription as { items: unknown[] };
    prescription.items.push({
      movementId: accessoryMovement!.id,
      movementSlug: accessoryMovement!.slug,
      movementName: accessoryMovement!.display_name,
      kind: "accessory",
      sets: 3,
      reps: 12,
      targetRir: { min: 1, max: 2 },
      intensityCue: "Clean reps. Leave 1–2 in the tank.",
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

    await page
      .getByTestId(`focus-strip-queue-${accessoryMovement!.id}`)
      .click();
    const focusStrip = page.getByTestId("focus-strip-logger");

    // The RIR chip + cue text both render under the focus card.
    const chip = focusStrip.getByTestId("accessory-intensity-chip");
    const cue = focusStrip.getByTestId("accessory-intensity-cue");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/RIR\s*1[\u2013–-]2/);
    await expect(cue).toBeVisible();
    await expect(cue).toContainText(/clean reps/i);

    // Brand purity — no methodology / external program name leaks into UI copy.
    const cueText = (await cue.textContent()) ?? "";
    expect(cueText).not.toMatch(
      /wendler|5\/3\/1|531|sheiko|smolov|westside|conjugate/i,
    );
  });
});
