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
    const navigator = page.getByTestId("movement-navigator");
    const openNav = page.getByTestId("movement-navigator-open");
    const queueItem = page.getByTestId(
      `movement-navigator-item-${seed.todayMovementId}`,
    );
    const swap = page.getByTestId("focus-strip-swap");
    await expect(logger).toBeVisible();

    // Movement navigation lives in a sheet opened from the dock — the old
    // horizontally-scrolling queue clipped most movements off-screen.
    await openNav.click();
    await expect(navigator).toHaveAttribute("aria-hidden", "false");
    await expect(queueItem).toHaveAttribute("aria-current", "true");

    const viewport = page.viewportSize()!;
    const loggerBox = await logger.boundingBox();
    const queueBox = await queueItem.boundingBox();
    const openNavBox = await openNav.boundingBox();
    expect(loggerBox).not.toBeNull();
    expect(loggerBox!.x).toBeGreaterThanOrEqual(0);
    expect(loggerBox!.x + loggerBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(queueBox?.height).toBeGreaterThanOrEqual(44);
    // Navigator rows are fully inside the viewport, never clipped.
    expect(queueBox!.x).toBeGreaterThanOrEqual(0);
    expect(queueBox!.x + queueBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(openNavBox?.height).toBeGreaterThanOrEqual(44);
    expect(swap).toBeTruthy();
    const swapBox = await swap.boundingBox();
    expect(swapBox?.height).toBeGreaterThanOrEqual(44);
    expect(swapBox?.width).toBeGreaterThanOrEqual(44);
    await page.getByTestId("movement-navigator-close").click();
    await expect(navigator).toHaveAttribute("aria-hidden", "true");

    await logPrescribedSet(page, seed.todayMovementId);
    const loggedSegment = page.locator(
      '[data-testid="movement-dot-0"][data-logged="true"]',
    );
    await expect(loggedSegment).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("focus-strip-end-movement").click();
    await openNav.click();
    await expect(queueItem).toHaveAttribute("data-done", "true");
    await expect(
      page.getByTestId(`movement-navigator-item-${carry!.id}`),
    ).toHaveAttribute("aria-current", "true");

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

  test("stays on a 3–5 set movement once the required sets are done", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    // Reported as: "If a set has 5 sets of which 3 are required the cursor
    // moves to the next movement when I finish the 3rd required set, even
    // though I would want to do all 5."
    //
    // Tactical Barbell writes 3–5 sets. Leaving at three is the app choosing
    // the lifter's volume for them; leaving early is the End movement button.
    const url = baseURL ?? "http://localhost:3000";
    await markOnboarded(admin, freshUser.userId);
    await seedStrengthTms(admin, freshUser.userId);
    const seed = await seedActiveBlock(admin, freshUser.userId);
    const { data: planned, error: plannedError } = await admin
      .from("planned_sessions")
      .select("prescription")
      .eq("id", seed.todayPlannedId)
      .single();
    expect(plannedError).toBeNull();
    const prescription = planned!.prescription as {
      items: Array<Record<string, unknown>>;
    };
    const base = prescription.items[0]!;
    // Three required sets, then two the lifter may or may not take.
    prescription.items = [
      base,
      { ...base },
      { ...base },
      { ...base, optional: true },
      { ...base, optional: true },
    ];
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
    await expect(page.getByTestId("focus-strip-logger")).toBeVisible();

    for (let set = 0; set < 3; set += 1) {
      await logPrescribedSet(page, seed.todayMovementId);
      await expect(
        page.locator(`[data-testid="movement-dot-${set}"][data-logged="true"]`),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Still here, with the fourth set open and cued.
    await page.getByTestId("movement-navigator-open").click();
    await expect(
      page.getByTestId(`movement-navigator-item-${seed.todayMovementId}`),
    ).toHaveAttribute("aria-current", "true");
    await page.getByTestId("movement-navigator-close").click();
    await expect(page.getByTestId("movement-dot-3")).toHaveAttribute(
      "data-logged",
      "false",
    );
    await expect(page.getByTestId("movement-dot-3")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Leaving is a deliberate act, and it is the only thing that moves on.
    await page.getByTestId("focus-strip-end-movement").click();
    await page.getByTestId("movement-navigator-open").click();
    await expect(
      page.getByTestId(`movement-navigator-item-${seed.todayMovementId}`),
    ).toHaveAttribute("aria-current", "false");
  });
});
