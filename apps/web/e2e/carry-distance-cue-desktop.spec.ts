import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Loaded-carry distance cue on the focus view.
 *
 * Carries are prescribed by metres, never reps — McGill 2014 +
 * practitioner consensus. The accessory-intensity matrix emits a
 * `distanceM` range on every carry item; the focus view surfaces it
 * as a chip + plain-language cue, and swaps the reps stepper for a
 * distance stepper.
 *
 * Scenario:
 *   1. Seed today's strength session and patch the prescription with
 *      a Farmer Carry accessory item carrying the matrix's strength /
 *      week-2 distance range (`30–40 m`) and the carry cue copy.
 *   2. Sign in, start the session, and select the carry.
 *   3. Assert the meters chip + cue copy + distance stepper are
 *      visible, and that NO rep stepper / "× N reps" target line is
 *      rendered.
 */
test.describe("@desktop Focus Strip — loaded carry distance cue", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("renders the meters chip, cue copy, and distance stepper on a carry card", async ({
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

    // Resolve a known carry movement from the seed catalog.
    const { data: carry, error: cErr } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .eq("slug", "farmer-carry-db")
      .maybeSingle();
    expect(cErr).toBeFalsy();
    expect(carry).toBeTruthy();

    // Patch the planned prescription with a carry item carrying the
    // strength_anchor × week-2 matrix output. Doing it inline rather
    // than relying on the picker keeps the spec deterministic.
    const { data: planned, error: pErr } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(pErr).toBeFalsy();
    const prescription = planned!.prescription as { items: unknown[] };
    prescription.items.push({
      movementId: carry!.id,
      movementSlug: carry!.slug,
      movementName: carry!.display_name,
      kind: "accessory",
      sets: 3,
      // No reps — carries are programmed by distance, not reps.
      distanceM: { min: 30, max: 40 },
      intensityCue:
        "Brace hard. Walk heavy with controlled steps. Set the load down between trips.",
    });
    const { error: upErr } = await admin
      .from("planned_sessions")
      .update({ prescription })
      .eq("id", seed.todayPlannedId);
    expect(upErr).toBeFalsy();

    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const startCta = page.getByRole("link", { name: /start workout/i }).first();
    await expect(startCta).toBeVisible({ timeout: 15_000 });
    await startCta.click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
      timeout: 15_000,
    });

    await page.getByTestId(`focus-strip-queue-${carry!.id}`).click();
    const carryCard = page.getByTestId("focus-strip-logger");

    // Meters chip + cue copy both render under the focus card.
    const chip = carryCard.getByTestId("accessory-intensity-chip");
    const cue = carryCard.getByTestId("accessory-intensity-cue");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/30[\u2013–-]40m\s+carry/i);
    await expect(cue).toBeVisible();
    await expect(cue).toContainText(/brace/i);
    await expect(cue).toContainText(/walk/i);

    // Distance stepper visible; reps stepper absent.
    const distanceStepper = carryCard.getByTestId("stepper-distance");
    await expect(distanceStepper).toBeVisible();
    await expect(distanceStepper).toContainText(/distance/i);

    // No "× N reps" target line for a carry — only the meters readout.
    const target = carryCard.locator("text=/×\\s*\\d+\\s+reps/");
    await expect(target).toHaveCount(0);

    // Brand purity — no methodology / external program name leaks.
    const cueText = (await cue.textContent()) ?? "";
    expect(cueText).not.toMatch(
      /wendler|5\/3\/1|531|sheiko|smolov|westside|conjugate/i,
    );
  });
});
