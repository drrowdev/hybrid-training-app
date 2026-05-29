import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * RPE zone picker + per-set skip-with-reason desktop coverage.
 *
 * Scenario:
 *   1. Seed an active block, sign in, start today's planned session.
 *   2. Direct redirect lands on the session detail page (interstitial removed).
 *   3. Expand the prescribed movement card → focus view.
 *   4. Set weight + reps, tap the "Hard" zone, log the first set.
 *      Verify service-role: set_logs row exists with rpe = 8.75.
 *   5. Tap "Skip set" → pick "Pain" → confirm.
 *      Verify: a second set_logs row with skipped=true, skip_reason='pain',
 *      weight_kg=0, reps=0, rpe=null.
 *   6. The dot strip renders the skipped slot with the
 *      hollow-dashed warning treatment (data-skipped="true").
 *   7. The movement card progress chip counts the skipped set
 *      toward "covered".
 */
test.describe("@desktop session log — zone RPE + skip", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("logs a Hard-zone set and a Pain-skip set", async ({
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
    await signInAs(context, freshUser, seedConfig, url);

    // Open today's planned session via the /app CTA.
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    const startCta = page.getByRole("link", { name: /start workout/i }).first();
    await expect(startCta).toBeVisible();
    await startCta.click();

    // Pre-session interstitial removed — auto-redirect to the session log.
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
      timeout: 15_000,
    });
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;

    // Expand the prescribed movement card so the focus view renders.
    const card = page.locator(
      `[data-testid="movement-card-${seed.todayMovementId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });
    if ((await card.getAttribute("data-collapsed")) === "true") {
      await page
        .getByTestId(`movement-card-header-${seed.todayMovementId}`)
        .click();
    }

    // The focus view exposes the new Hard zone card. Tap it before
    // logging — value gets persisted as the zone midpoint (8.75).
    const focus = page.getByTestId("movement-focus-view");
    await expect(focus).toBeVisible();
    await page.getByTestId("rpe-zone-hard").click();
    await expect(page.getByTestId("rpe-zone-picker")).toHaveAttribute(
      "data-active-zone",
      "hard",
    );

    // Fill the steppers — the picker doesn't care about weight/reps.
    await page.getByLabel("Weight (kg)").fill("80");
    await page.getByLabel("Reps").fill("5");
    await page.getByTestId("movement-focus-log-button").click();

    // Wait for the server action to revalidate. The first dot should
    // become "logged" (not skipped).
    await expect(page.locator('[data-testid="movement-dot-0"][data-logged="true"]')).toBeVisible({
      timeout: 15_000,
    });

    // Service-role: the row carries rpe = 8.75 (Hard midpoint).
    const { data: firstRow, error: firstErr } = await admin
      .from("set_logs")
      .select("weight_kg, reps, rpe, skipped, skip_reason")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    expect(firstErr).toBeNull();
    expect(firstRow?.skipped).toBe(false);
    expect(Number(firstRow?.rpe)).toBeCloseTo(8.75, 3);
    expect(Number(firstRow?.weight_kg)).toBeCloseTo(80, 3);
    expect(firstRow?.reps).toBe(5);

    // Now skip the next set with reason "Pain".
    await page.getByTestId("movement-focus-skip-button").click();
    await expect(page.getByTestId("skip-set-menu")).toBeVisible();
    await page.getByTestId("skip-reason-pain").click();
    await page.getByTestId("skip-confirm").click();

    // Wait for the second slot to render with the skipped treatment.
    const skippedDot = page.locator(
      '[data-testid="movement-dot-1"][data-skipped="true"]',
    );
    await expect(skippedDot).toBeVisible({ timeout: 15_000 });

    // Service-role: the skipped row is persisted as weight 0 / reps 0
    // / rpe null / skip_reason 'pain'.
    const { data: rows, error: rowsErr } = await admin
      .from("set_logs")
      .select("set_index, weight_kg, reps, rpe, skipped, skip_reason")
      .eq("session_id", sessionId)
      .order("set_index", { ascending: true });
    expect(rowsErr).toBeNull();
    expect(rows?.length ?? 0).toBeGreaterThanOrEqual(2);
    const skippedRow = (rows ?? []).find((r) => r.skipped);
    expect(skippedRow).toBeTruthy();
    expect(skippedRow!.skip_reason).toBe("pain");
    expect(Number(skippedRow!.weight_kg)).toBeCloseTo(0, 3);
    expect(skippedRow!.reps).toBe(0);
    expect(skippedRow!.rpe).toBeNull();

    // Movement card progress chip should now count both sets as
    // covered (chip text "X/Y" where X includes the skipped set).
    const chip = page.getByTestId(
      `movement-card-chip-${seed.todayMovementId}`,
    );
    const chipText = (await chip.innerText()).trim();
    // Chip is "done/total" or "done/total ✓" when complete. Either
    // way the leading numerator must be >= 2 because we covered two
    // slots.
    const match = chipText.match(/^(\d+)\s*\/\s*(\d+)/);
    expect(match).toBeTruthy();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
  });
});
