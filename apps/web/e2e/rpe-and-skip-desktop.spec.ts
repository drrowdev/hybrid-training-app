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
 *   3. Select the prescribed movement in the Focus Strip.
 *   4. Set weight + reps, tap the "Hard" zone, log the first set.
 *      Verify service-role: set_logs row exists with rpe = 8.75.
 *   5. Tap "Skip set" → pick "Pain" → confirm.
 *      Verify: a second set_logs row with skipped=true, skip_reason='pain',
 *      weight_kg=0, reps=0, rpe=null.
 *   6. The dot strip renders the skipped slot with the
 *      hollow-dashed warning treatment (data-skipped="true").
 *   7. Click the amber skipped segment and restore it inline.
 */
test.describe("@desktop Focus Strip — zone RPE + skip", () => {
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

    await page
      .getByTestId(`focus-strip-queue-${seed.todayMovementId}`)
      .click();

    // Skip the current set with a reason so its segment becomes amber.
    const focus = page.getByTestId("movement-focus-view");
    await expect(focus).toBeVisible();
    await page.getByTestId("movement-focus-skip-button").click();
    await expect(page.getByTestId("skip-set-menu")).toBeVisible();
    await page.getByTestId("skip-reason-pain").click();
    await page.getByTestId("skip-confirm").click();

    // The progress strip is navigation. Revisit the skipped slot and
    // restore it inline with a Hard RPE.
    const skippedDot = page.locator(
      '[data-testid="movement-dot-0"][data-skipped="true"]',
    );
    await expect(skippedDot).toBeVisible({ timeout: 15_000 });
    let skippedRowId = "";
    await expect
      .poll(
        async () => {
          const { data, error } = await admin
            .from("set_logs")
            .select("id, skipped, skip_reason")
            .eq("session_id", sessionId)
            .maybeSingle();
          expect(error).toBeNull();
          skippedRowId = data?.id ?? "";
          return data;
        },
        { timeout: 15_000 },
      )
      .toEqual(
        expect.objectContaining({
          skipped: true,
          skip_reason: "pain",
        }),
      );
    await skippedDot.click();
    await page.getByTestId("rpe-zone-hard").click();
    await page.getByRole("textbox", { name: "Weight (kg)", exact: true }).fill("80");
    await page.getByRole("textbox", { name: "Reps", exact: true }).fill("5");
    const restore = page.getByTestId("movement-focus-log-button");
    await expect(restore).toContainText("Restore set");
    await restore.click();
    await expect(
      page.locator(
        '[data-testid="movement-dot-0"][data-logged="true"][data-skipped="false"]',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("set_logs")
            .select("id, skipped, skip_reason, weight_kg, reps, rpe")
            .eq("session_id", sessionId)
            .order("set_index", { ascending: true });
          return data ?? [];
        },
        { timeout: 15_000 },
      )
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: skippedRowId,
            skipped: false,
            skip_reason: null,
            weight_kg: 80,
            reps: 5,
            rpe: 8.8,
          }),
        ]),
      );
    const { count } = await admin
      .from("set_logs")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    expect(count).toBe(1);
    const queue = page.getByTestId(
      `focus-strip-queue-${seed.todayMovementId}`,
    );
    await expect(queue).toContainText("✓");
  });
});
