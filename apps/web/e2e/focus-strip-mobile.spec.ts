import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";
import { logPrescribedSet } from "./fixtures/log-flow";

test.describe("@mobile Focus Strip logger", () => {
  test("logs one-handed and reopens a completed set inline", async ({
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
    const { data: carry, error: carryError } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .eq("slug", "farmer-carry-db")
      .single();
    expect(carryError).toBeNull();
    const { data: planned, error: plannedError } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(plannedError).toBeNull();
    const prescription = planned!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    prescription.items.push({
      ...prescription.items[0],
      optional: true,
    });
    prescription.items.push({
      movementId: carry!.id,
      movementSlug: carry!.slug,
      movementName: carry!.display_name,
      kind: "accessory",
      sets: 1,
      reps: 20,
    });
    const { error: updateError } = await admin
      .from("planned_sessions")
      .update({ prescription })
      .eq("id", seed.todayPlannedId);
    expect(updateError).toBeNull();
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.getByRole("link", { name: /start workout/i }).first().click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, {
      timeout: 15_000,
    });

    const logger = page.getByTestId("focus-strip-logger");
    const queueItem = page.getByTestId(
      `focus-strip-queue-${seed.todayMovementId}`,
    );
    const swap = page.getByTestId("focus-strip-swap");
    await expect(logger).toBeVisible();
    await expect(queueItem).toHaveAttribute("aria-pressed", "true");

    const viewport = page.viewportSize()!;
    const loggerBox = await logger.boundingBox();
    const queueBox = await queueItem.boundingBox();
    const swapBox = await swap.boundingBox();
    expect(loggerBox).not.toBeNull();
    expect(loggerBox!.x).toBeGreaterThanOrEqual(0);
    expect(loggerBox!.x + loggerBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(queueBox?.height).toBeGreaterThanOrEqual(44);
    expect(swapBox?.height).toBeGreaterThanOrEqual(44);
    expect(swapBox?.width).toBeGreaterThanOrEqual(44);

    await logPrescribedSet(page, seed.todayMovementId);
    const loggedSegment = page.locator(
      '[data-testid="movement-dot-0"][data-logged="true"]',
    );
    await expect(loggedSegment).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("focus-strip-end-movement").click();
    await expect(queueItem).toContainText("✓");
    await expect(
      page.getByTestId(`focus-strip-queue-${carry!.id}`),
    ).toHaveAttribute("aria-pressed", "true");

    // Ending optional work advances, but the movement remains reversible.
    await queueItem.click();
    await expect(
      page.getByTestId("focus-strip-optional-declined"),
    ).toBeVisible();
    await page.getByTestId("focus-strip-reopen-optional").click();
    await expect(page.getByTestId("movement-focus-view")).toBeVisible();

    await loggedSegment.click();
    await expect(page.getByTestId("movement-focus-log-button")).toContainText(
      "Update set",
    );
  });
});
