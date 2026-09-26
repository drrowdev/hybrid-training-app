import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";
import { seedActiveBlock } from "./fixtures/session-log";

/**
 * Today workout layout: card-owned program progress, grouped exercises,
 * start navigation, mobile dock and accessible workout options.
 *
 * Auth + onboarding follow the same fixture pattern as the existing
 * session-log spec — see e2e/README.md for the wider rationale.
 */

test.describe("@desktop today page (Phase 1)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only for first PR");

  test("hero keeps metadata singular and separates main/supplemental lifts", async ({
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
    const { data: movements } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .in("slug", [
        "bench-press-flat",
        "bb-row-overhand",
        "pull-up-overhand",
        "ohp-standing",
      ])
      .is("user_id", null);
    expect(movements).toHaveLength(4);
    const bySlug = new Map(movements!.map((movement) => [movement.slug, movement]));
    const repeated = (
      slug: string,
      kind: "main" | "back_off",
      count: number,
      percentTm?: number,
    ) =>
      Array.from({ length: count }, (_, index) => {
        const movement = bySlug.get(slug)!;
        return {
          movementId: movement.id,
          movementSlug: movement.slug,
          movementName: movement.display_name,
          kind,
          sets: 1,
          reps: 8,
          ...(percentTm != null ? { percentTm } : {}),
          ...(kind === "back_off"
            ? {
                setRange: { min: 3, max: 5 },
                repRange: { min: 8, max: 10 },
                ...(index >= 3 ? { optional: true } : {}),
              }
            : {}),
        };
      });
    const { error: prescriptionError } = await admin
      .from("planned_sessions")
      .update({
        title: "Armor B1 · 70%",
        prescription: {
          items: [
            ...repeated("bench-press-flat", "main", 4, 70),
            ...repeated("bb-row-overhand", "main", 4, 70),
            ...repeated("pull-up-overhand", "back_off", 5),
            ...repeated("ohp-standing", "back_off", 5, 65),
          ],
        },
      })
      .eq("id", seed.todayPlannedId);
    expect(prescriptionError).toBeNull();
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // The hero card targets the seeded planned session for today.
    const hero = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await expect(hero).toBeVisible();

    const eyebrow = page.getByTestId("today-eyebrow");
    await expect(eyebrow).not.toContainText(/WEEK 1 OF 4/i);
    await expect(hero).toContainText(/WEEK 1 OF 4/i);
    await expect(page.getByTestId("hero-topline")).toHaveCount(0);
    await expect(hero.getByText(/Top set/i)).toHaveCount(0);
    await expect(
      hero.getByTestId("session-preview-section-strength").getByRole("heading", { level: 3 }),
    ).toBeVisible();
    await expect(
      hero.getByTestId("session-preview-section-supplemental").getByRole("heading", { level: 3 }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("today-mobile-cta")).toHaveAttribute("href", `/app/sessions/start/${seed.todayPlannedId}`);
    await expect(page.getByTestId("today-cta")).not.toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });

    // Primary CTA → start session route (server-side auto-create + redirect).
    const cta = page.getByTestId("today-cta").first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/start workout/i);
    const href = await cta.getAttribute("href");
    expect(href).toBe(`/app/sessions/start/${seed.todayPlannedId}`);

    await expect(page.getByTestId("today-preview-cta")).toHaveCount(0);
    await hero.getByRole("button", { name: /^Options for / }).click();
    await expect(hero.getByRole("menu")).toBeVisible();
    await hero.getByRole("menu").getByRole("menuitem", { name: "Move to another day" }).focus();
    await page.keyboard.press("Escape");
    await expect(hero.getByRole("menu")).toHaveCount(0);

    // Clicking Start auto-creates the session and lands on the log surface.
    // (The pre-session check-in interstitial was removed; the Today-page
    // wellness check-in card was retired in a later chore.)
    await cta.click();
    await page.waitForURL(/\/app\/sessions\/[0-9a-f-]{36}(?:\?|$|#)/, { timeout: 15_000 });
  });

  test("rest day links the next workout and the week links the schedule", async ({
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
    // Seed a 4-day block so today is a training day, then drop today's
    // planned_session so the page renders the rest-day banner.
    const seed = await seedActiveBlock(admin, freshUser.userId);
    await admin.from("planned_sessions").delete().eq("id", seed.todayPlannedId);

    await signInAs(context, freshUser, seedConfig, url);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const rest = page.getByTestId("today-rest");
    await expect(rest).toBeVisible();
    await expect(rest).toContainText(/rest day/i);
    // Next-session preview points at the upcoming planned session.
    await expect(page.getByTestId("rest-tomorrow")).toBeVisible();
    // Rest navigation opens the workout; the week owns the schedule link.
    await expect(rest.getByRole("link")).toHaveAttribute("href", /\/app\/sessions\/start\//);
    await expect(page.getByTestId("today-week-strip").getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/app/plan?view=month");
    await expect(rest.getByRole("link", { name: /log freestyle/i })).toHaveCount(0);
    // Removed regressions guarded with toHaveCount(0).
    await expect(rest.locator(".cp-info")).toHaveCount(0);
  });

  test("training-day hero exposes Start workout and workout options", async ({
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

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    const cta = page.getByTestId("today-cta").first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText(/start workout/i);
    expect(await cta.getAttribute("href")).toBe(`/app/sessions/start/${seed.todayPlannedId}`);

    const hero = page.getByTestId(`today-card-${seed.todayPlannedId}`);
    await hero.getByRole("button", { name: /^Options for / }).click();
    await expect(hero.getByRole("menuitem", { name: "Skip workout" })).toBeVisible();
    await page.keyboard.press("Escape");

    const week = page.getByTestId("today-week-strip");
    const preview = week.locator(`a[href="#session=${seed.todayPlannedId}"]`);
    await expect(preview).toHaveAccessibleName(/^Open .+, /);
    await preview.click();
    await expect(page.getByTestId("plan-drawer")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-mark-done")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-swap")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-skip")).toBeVisible();
    await expect(page.getByTestId("plan-drawer-notes")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("plan-drawer")).toHaveCount(0);
    await week.getByRole("link", { name: "Schedule" }).click();
    await expect(page).toHaveURL(/\/app\/plan\?view=month/);
    await expect(page.getByTestId("plan-month-grid")).toBeVisible();
  });

  test("Today regressions — removed surfaces stay removed", async ({
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
    await seedActiveBlock(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // Only one eligible prompt can be shown.
    expect(await page.getByTestId("today-prompt").count()).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("bw-nudge")).toHaveCount(0);
    await expect(page.getByRole("spinbutton", { name: /bodyweight/i })).toHaveCount(0);
    // 2) "Up next this week" section is gone — handled by /app/plan.
    await expect(page.getByRole("heading", { name: /up next this week/i })).toHaveCount(0);
    // 3) The legacy "How recovered you are" heading (RegionFreshnessCard
    //    / retired HowRecoveredCard) — gone from Today.
    await expect(page.getByRole("heading", { name: /how recovered you are/i })).toHaveCount(0);
    // 4) The floating injury FAB is gone everywhere on /app.
    await expect(page.locator(".cp-fab")).toHaveCount(0);

    // The new compressed week strip replaces the right-rail WeekDotsCard.
    await expect(page.getByTestId("today-week-strip")).toBeVisible();
  });

  test("Quick workout follows workouts and precedes the week; recent activity stays in Stats", async ({
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
    await seedActiveBlock(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    await page.goto("/app");
    await page.waitForLoadState("networkidle");

    // DOM-order test: hero (today-cta) precedes the quick-workout card, which
    // precedes the week strip, which precedes the Recent activity heading.
    // Asserted via DOM document order (compareDocumentPosition) rather than
    // viewport-Y — the right rail and left column have unrelated Y offsets in
    // the two-column desktop layout, so a top-coordinate comparison is invalid.
    const quick = page.getByTestId("quick-workout-card");
    const week = page.getByTestId("today-week-strip");
    const recent = page.getByRole("heading", { name: /^recent activity$/i }).first();
    const hero = page.getByTestId("today-cta").first();

    await expect(hero).toBeVisible();
    await expect(quick).toBeVisible();
    await expect(week).toBeVisible();
    await expect(recent).toHaveCount(0);

    const inOrder = await page.evaluate(
      (els) => {
        const before = (a: Element, b: Element) =>
          (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const [h, q, w] = els as Element[];
        return before(h, q) && before(q, w);
      },
      [
        await hero.elementHandle(),
        await quick.elementHandle(),
        await week.elementHandle(),
      ],
    );
    expect(inOrder).toBe(true);
  });
});
